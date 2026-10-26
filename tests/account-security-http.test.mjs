import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

test(
  "HTTP security regressions: password/session invalidation, customer grant revocation and admin-only readiness",
  { timeout: 120000 },
  async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), "crm-account-http-"));
    const probe = createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const base = `http://127.0.0.1:${port}`;
    let logs = "",
      db;
    const server = spawn(
      process.execPath,
      [
        "node_modules/next/dist/bin/next",
        "start",
        "-H",
        "127.0.0.1",
        "-p",
        String(port),
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATA_DIR: dir,
          APP_URL: base,
          SETUP_TOKEN: "",
          BACKUP_PASSPHRASE: "",
          WA_PROXY_URL: "direct",
          NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout.on("data", (d) => (logs += d));
    server.stderr.on("data", (d) => (logs += d));
    const request = async (url, cookie = "", body, method = "POST") => {
      const r = await fetch(base + url, {
        method: body === undefined ? "GET" : method,
        headers: {
          Origin: base,
          Cookie: cookie,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: r.status,
        body: await r.json(),
        cookie: r.headers.get("set-cookie")?.split(";")[0],
      };
    };
    const login = async (email, password = "SyntheticCRM2026!") => {
      const r = await request("/api/auth/login", "", { email, password });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.cookie;
    };
    try {
      for (let i = 0; i < 120; i++) {
        try {
          if ((await fetch(base + "/api/auth/setup")).ok) break;
        } catch {}
        if (i === 119) throw Error(logs.slice(-2000));
        await new Promise((r) => setTimeout(r, 200));
      }
      const setup = await request("/api/auth/setup", "", {
        name: "Synthetic admin",
        email: "admin@example.test",
        password: "SyntheticCRM2026!",
      });
      assert.equal(setup.status, 200, JSON.stringify(setup.body));
      const admin = setup.cookie;
      for (const [name, role] of [
        ["sales", "sales"],
        ["other", "sales"],
        ["viewer", "viewer"],
      ])
        assert.equal(
          (
            await request("/api/users", admin, {
              name,
              email: `${name}@example.test`,
              password: "SyntheticCRM2026!",
              role,
            })
          ).status,
          201,
        );
      const users = (await request("/api/users", admin)).body.users;
      const uid = (name) =>
        users.find((u) => u.email === `${name}@example.test`).id;
      let sales = await login("sales@example.test"),
        other = await login("other@example.test"),
        viewer = await login("viewer@example.test");
      await t.test(
        "self-service password changes reject the wrong current password and revoke every previous session",
        async () => {
          const second = await login("sales@example.test");
          const wrong = await request("/api/auth/password", sales, {
            currentPassword: "WrongPassword2026!",
            newPassword: "NewSyntheticCRM2026!",
          });
          assert.ok(wrong.status >= 400);
          assert.equal((await request("/api/customers", sales)).status, 200);
          assert.equal((await request("/api/customers", second)).status, 200);
          const changed = await request("/api/auth/password", sales, {
            currentPassword: "SyntheticCRM2026!",
            newPassword: "NewSyntheticCRM2026!",
          });
          assert.equal(changed.status, 200);
          assert.equal(changed.body.reauthRequired, true);
          assert.equal((await request("/api/customers", sales)).status, 401);
          assert.equal((await request("/api/customers", second)).status, 401);
          assert.equal((await request("/api/customers", admin)).status, 200);
          sales = await login("sales@example.test", "NewSyntheticCRM2026!");
        },
      );
      await t.test(
        "administrator resets, disable/re-enable and role changes cannot resurrect old login cookies",
        async () => {
          const reset = await request(
            "/api/users",
            admin,
            { id: uid("sales"), resetPassword: "ResetSyntheticCRM2026!" },
            "PATCH",
          );
          assert.equal(reset.status, 200);
          assert.ok(reset.body.sessionsRevoked >= 1);
          assert.equal((await request("/api/customers", sales)).status, 401);
          sales = await login("sales@example.test", "ResetSyntheticCRM2026!");
          assert.equal(
            (
              await request(
                "/api/users",
                admin,
                { id: uid("other"), status: "disabled" },
                "PATCH",
              )
            ).status,
            200,
          );
          assert.equal(
            (
              await request(
                "/api/users",
                admin,
                { id: uid("other"), status: "active" },
                "PATCH",
              )
            ).status,
            200,
          );
          assert.equal((await request("/api/customers", other)).status, 401);
          other = await login("other@example.test");
          assert.equal(
            (
              await request(
                "/api/users",
                admin,
                { id: uid("other"), role: "viewer" },
                "PATCH",
              )
            ).status,
            200,
          );
          assert.equal((await request("/api/customers", other)).status, 401);
          const lastAdmin = await request(
            "/api/users",
            admin,
            { id: uid("admin"), role: "sales" },
            "PATCH",
          );
          assert.ok(lastAdmin.status >= 400);
          assert.match(lastAdmin.body.error, /至少需要一个/);
          assert.equal((await request("/api/customers", admin)).status, 200);
        },
      );
      await t.test(
        "revoking customer access also protects customer-file originals; transferring does not delete messages",
        async () => {
          const r = await request("/api/customers", sales, {
            name: "Synthetic client",
            email: "client@example.test",
            raw: "Please quote two synthetic units.",
          });
          assert.equal(r.status, 201, JSON.stringify(r.body));
          const id = r.body.id,
            project = r.body.projects[0].id;
          const form = new FormData();
          form.set("scope", "customer");
          form.set("customerId", String(id));
          form.append(
            "files",
            new File(
              ["Synthetic confidential product attachment"],
              "private.txt",
              { type: "text/plain" },
            ),
          );
          const upload = await fetch(base + "/api/knowledge", {
            method: "POST",
            headers: { Origin: base, Cookie: sales },
            body: form,
          });
          assert.equal(upload.status, 200);
          const fileId = (await upload.json()).files[0].id;
          const access = (who, action) =>
            request(
              "/api/customers",
              admin,
              { id, action, userId: who },
              "PATCH",
            );
          assert.ok(
            (await request(`/api/customers?id=${id}`, viewer)).status >= 400,
          );
          assert.equal((await access(uid("viewer"), "grant")).status, 200);
          assert.equal(
            (await request(`/api/customers?id=${id}`, viewer)).status,
            200,
          );
          assert.equal(
            (
              await fetch(base + `/api/files/${fileId}`, {
                headers: { Cookie: viewer },
              })
            ).status,
            200,
          );
          assert.equal((await access(uid("viewer"), "revoke")).status, 200);
          assert.ok(
            (await request(`/api/customers?id=${id}`, viewer)).status >= 400,
          );
          assert.ok(
            (
              await fetch(base + `/api/files/${fileId}`, {
                headers: { Cookie: viewer },
              })
            ).status >= 400,
          );
          assert.ok(
            (
              await request("/api/messages", viewer, {
                customerId: id,
                projectId: project,
                body: "Must not write",
                status: "manual_sent",
              })
            ).status >= 400,
          );
          assert.equal((await access(uid("admin"), "transfer")).status, 200);
          assert.ok(
            (await request(`/api/customers?id=${id}`, sales)).status >= 400,
          );
          const after = await request(`/api/customers?id=${id}`, admin);
          assert.equal(after.status, 200);
          assert.ok(after.body.messages.length >= 1);
          db = new DatabaseSync(path.join(dir, "rehabintl-crm.sqlite"));
          assert.equal(
            db
              .prepare(
                "SELECT COUNT(*) n FROM communications WHERE customer_id=?",
              )
              .get(id).n,
            after.body.messages.length,
          );
        },
      );
      await t.test(
        "readiness and backup configuration are protected and never assert untested live services are working",
        async () => {
          assert.equal((await request("/api/readiness")).status, 401);
          assert.equal((await request("/api/readiness", viewer)).status, 403);
          const ready = await request("/api/readiness", admin);
          assert.equal(ready.status, 200, JSON.stringify(ready.body));
          assert.equal(ready.body.providers.length, 0);
          assert.equal(ready.body.whatsapp.connected, false);
          assert.equal(ready.body.backup.enabled, 0);
          assert.equal(ready.body.backup.offsite, "not_configured");
          assert.equal(
            (await request("/api/backups/schedule", viewer)).status,
            403,
          );
          const enable = await request("/api/backups/schedule", admin, {
            enabled: true,
            hour: 3,
          });
          assert.equal(enable.status, 400);
          assert.match(enable.body.error, /BACKUP_PASSPHRASE/);
          const status = await request("/api/backups", admin);
          assert.equal(status.body.scheduleConfigured, false);
        },
      );
    } finally {
      db?.close();
      server.kill();
      await new Promise((r) => server.once("exit", r));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
