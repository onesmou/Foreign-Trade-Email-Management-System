import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";
import { companyBrand } from "../lib/branding.ts";
import {
  createEncryptedBackup,
  stageEncryptedRestore,
  applyPendingRestore,
} from "../lib/backup-core.ts";

test("company display name falls back safely without an uploaded image", () => {
  assert.equal(companyBrand(null), "RehabIntl");
  assert.equal(
    companyBrand({ brand: "  ", company_name: "示例公司" }),
    "示例公司",
  );
  assert.equal(
    companyBrand({ brand: " 品牌 ", company_name: "示例公司" }),
    "品牌",
  );
});

test(
  "company branding: atomic upload, validation, permissions, cache, backup and removal",
  { timeout: 90000 },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "crm-branding-test-"));
    const dataDir = path.join(root, "source");
    mkdirSync(dataDir);
    const probe = createServer();
    await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
    const port = probe.address().port;
    await new Promise((resolve) => probe.close(resolve));
    const base = `http://127.0.0.1:${port}`;
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
        env: {
          ...process.env,
          DATA_DIR: dataDir,
          APP_URL: base,
          NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let logs = "",
      cookie = "";
    server.stdout.on("data", (d) => {
      logs += d;
    });
    server.stderr.on("data", (d) => {
      logs += d;
    });
    async function req(url, options = {}, actor = cookie) {
      const response = await fetch(base + url, {
        ...options,
        headers: { Origin: base, Cookie: actor, ...options.headers },
      });
      if (response.headers.get("set-cookie"))
        cookie = response.headers.get("set-cookie").split(";")[0];
      return { response, body: await response.json() };
    }
    const json = (body, method = "PATCH") => ({
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    try {
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(base + "/api/auth/setup")).ok) break;
        } catch {}
        if (i === 99) throw new Error(logs.slice(-1500));
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      assert.equal((await fetch(base + "/api/company-logo")).status, 401);
      let r = await req(
        "/api/auth/setup",
        json(
          {
            name: "Brand Test",
            email: "brand@example.test",
            password: "BrandTesting2026!",
            companyName: "Brand Test Company",
          },
          "POST",
        ),
      );
      assert.equal(r.response.status, 200, JSON.stringify(r.body));
      const admin = cookie;
      const before = (await req("/api/settings")).body.profile;
      const png = await sharp({
        create: {
          width: 1024,
          height: 256,
          channels: 4,
          background: { r: 25, g: 110, b: 75, alpha: 0.5 },
        },
      })
        .png()
        .withMetadata()
        .toBuffer();
      const upload = new FormData();
      upload.set("brand", "示例品牌");
      upload.set("logo", new File([png], "logo.png", { type: "image/png" }));
      r = await req("/api/settings", { method: "PATCH", body: upload });
      assert.equal(r.response.status, 200, JSON.stringify(r.body));
      const profile = r.body.profile;
      assert.equal(profile.brand, "示例品牌");
      assert.equal(
        profile.sales_email,
        before.sales_email,
        "partial save preserves omitted fields",
      );
      assert.equal(profile.sales_rules, before.sales_rules);
      assert.match(profile.logo_url, /^\/api\/company-logo\?v=[a-f0-9]{64}$/);
      let image = await fetch(base + profile.logo_url, {
        headers: { Cookie: admin },
      });
      assert.equal(image.status, 200);
      assert.equal(image.headers.get("content-type"), "image/webp");
      assert.match(image.headers.get("cache-control"), /private/);
      assert.equal(image.headers.get("x-content-type-options"), "nosniff");
      const savedBytes = Buffer.from(await image.arrayBuffer()),
        metadata = await sharp(savedBytes).metadata();
      assert.equal(metadata.width, 512);
      assert.equal(metadata.height, 128);
      assert.equal(metadata.hasAlpha, true);
      assert.equal(metadata.exif, undefined, "source metadata is stripped");
      assert.equal(
        (
          await fetch(base + profile.logo_url, {
            headers: {
              Cookie: admin,
              "If-None-Match": image.headers.get("etag"),
            },
          })
        ).status,
        304,
      );
      assert.equal(
        (
          await fetch(base + "/api/company-logo?v=stale", {
            headers: { Cookie: admin },
          })
        ).status,
        404,
      );
      for (const [bytes, name, expected] of [
        ["<svg><script>alert(1)</script></svg>", "fake.png", 400],
        [png.subarray(0, 24), "broken.png", 400],
        [Buffer.alloc(2 * 1024 * 1024 + 1), "large.png", 413],
      ]) {
        const bad = new FormData();
        bad.set("brand", "必须回滚");
        bad.set("logo", new File([bytes], name, { type: "image/png" }));
        assert.equal(
          (await req("/api/settings", { method: "PATCH", body: bad })).response
            .status,
          expected,
        );
        const current = (await req("/api/settings")).body.profile;
        assert.equal(current.brand, profile.brand);
        assert.equal(current.logo_url, profile.logo_url);
      }
      for (const input of [
        { brand: " " },
        { brand: {} },
        { sales_email: "not-email" },
        { website: "javascript:alert(1)" },
      ])
        assert.equal(
          (await req("/api/settings", json(input))).response.status,
          400,
        );
      assert.equal(
        (
          await req("/api/settings", {
            ...json({ brand: "foreign" }),
            headers: {
              "Content-Type": "application/json",
              Origin: "https://unrelated.test",
            },
          })
        ).response.status,
        403,
      );
      await req(
        "/api/settings",
        json({ logo_url: "https://unrelated.test/fake.png" }),
      );
      assert.equal(
        (await req("/api/settings")).body.profile.logo_url,
        profile.logo_url,
      );
      for (const role of ["viewer", "sales"]) {
        cookie = admin;
        assert.equal(
          (
            await req(
              "/api/users",
              json(
                {
                  name: role,
                  email: `${role}@brand.test`,
                  password: "RoleTesting2026!",
                  role,
                },
                "POST",
              ),
            )
          ).response.status,
          201,
        );
        await req(
          "/api/auth/login",
          json(
            { email: `${role}@brand.test`, password: "RoleTesting2026!" },
            "POST",
          ),
        );
        assert.equal(
          (
            await req(
              "/api/settings",
              json({ brand: "forbidden", remove_logo: true }),
            )
          ).response.status,
          403,
        );
        assert.equal(
          (
            await fetch(base + profile.logo_url, {
              headers: { Cookie: cookie },
            })
          ).status,
          200,
        );
      }
      cookie = admin;
      const backup = await createEncryptedBackup({
        dataDir,
        envContents: "",
        passphrase: "BrandBackup2026!",
        retentionDays: 30,
        retentionCount: 5,
      });
      const restoredDir = path.join(root, "restored");
      mkdirSync(restoredDir);
      await stageEncryptedRestore({
        dataDir: restoredDir,
        encryptedFile: path.join(dataDir, "backups", backup.id),
        passphrase: "BrandBackup2026!",
      });
      applyPendingRestore(restoredDir);
      const restored = new DatabaseSync(
        path.join(restoredDir, "rehabintl-crm.sqlite"),
      );
      assert.deepEqual(
        Buffer.from(
          restored.prepare("SELECT logo FROM company_branding WHERE id=1").get()
            .logo,
        ),
        savedBytes,
      );
      restored.close();
      r = await req("/api/settings", json({ remove_logo: true }));
      assert.equal(r.response.status, 200);
      assert.equal(r.body.profile.logo_url, "");
      assert.equal(r.body.profile.brand, "示例品牌");
      image = await fetch(base + profile.logo_url, {
        headers: { Cookie: admin },
      });
      assert.equal(image.status, 404);
    } finally {
      server.kill();
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (
        !path
          .resolve(root)
          .startsWith(path.resolve(tmpdir()) + path.sep + "crm-branding-test-")
      )
        throw new Error("Refusing unsafe cleanup");
      rmSync(root, { recursive: true, force: true });
    }
  },
);
