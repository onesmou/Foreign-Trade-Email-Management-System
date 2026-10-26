import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

test("server env generator creates distinct secrets without logging/overwriting and requires HTTPS", () => {
  const root = mkdtempSync(path.join(tmpdir(), "crm-env-")),
    output = path.join(root, ".env");
  const run = (url) =>
    spawnSync(
      process.execPath,
      ["scripts/init-env.mjs", "--url", url, "--output", output],
      { encoding: "utf8" },
    );
  try {
    assert.notEqual(run("http://crm.example.test").status, 0);
    const first = run("https://crm.example.test");
    assert.equal(first.status, 0, first.stderr);
    const raw = readFileSync(output, "utf8"),
      secrets = [
        ...raw.matchAll(
          /^(?:APP_SECRET|SETUP_TOKEN|BACKUP_PASSPHRASE)=([a-f\d]{64})$/gm,
        ),
      ].map((m) => m[1]);
    assert.equal(secrets.length, 3);
    assert.equal(new Set(secrets).size, 3);
    for (const secret of secrets) assert.ok(!first.stdout.includes(secret));
    assert.notEqual(run("https://crm.example.test").status, 0);
    assert.equal(readFileSync(output, "utf8"), raw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "first-admin token is never disclosed and concurrent setup cannot create two administrators",
  { timeout: 90000 },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "crm-setup-")),
      probe = createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
    const base = `http://127.0.0.1:${port}`,
      token = "SYNTHETIC_FIRST_ADMIN_TOKEN_not_a_real_credential";
    let logs = "";
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
          DATA_DIR: root,
          APP_URL: base,
          SETUP_TOKEN: token,
          NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout.on("data", (d) => (logs += d));
    server.stderr.on("data", (d) => (logs += d));
    const post = (email, setupToken) =>
      fetch(base + "/api/auth/setup", {
        method: "POST",
        headers: { Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Synthetic Admin",
          email,
          password: "TestSetup2026!",
          setupToken,
        }),
      });
    try {
      for (let n = 0; n < 100; n++) {
        try {
          if ((await fetch(base + "/api/auth/setup")).ok) break;
        } catch {}
        if (n === 99) throw Error(logs.slice(-2000));
        await new Promise((r) => setTimeout(r, 200));
      }
      let response = await fetch(base + "/api/auth/setup"),
        text = await response.text();
      assert.ok(!text.includes(token));
      assert.equal(JSON.parse(text).requiresSetupToken, true);
      assert.equal((await post("one@example.test", "")).status, 403);
      assert.equal((await post("one@example.test", "wrong")).status, 403);
      const both = await Promise.all([
        post("one@example.test", token),
        post("two@example.test", token),
      ]);
      assert.deepEqual(both.map((r) => r.status).sort(), [200, 409]);
      response = await fetch(base + "/api/auth/setup");
      assert.deepEqual(await response.json(), {
        needsSetup: false,
        requiresSetupToken: false,
      });
      const db = new DatabaseSync(path.join(root, "rehabintl-crm.sqlite"), {
        readOnly: true,
      });
      assert.equal(
        db.prepare("SELECT count(*) n FROM users WHERE role='admin'").get().n,
        1,
      );
      db.close();
    } finally {
      server.kill();
      await new Promise((r) => server.once("exit", r));
      rmSync(root, { recursive: true, force: true });
    }
  },
);
