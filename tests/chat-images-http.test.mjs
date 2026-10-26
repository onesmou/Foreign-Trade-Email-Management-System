import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import sharp from "sharp";

test(
  "image chat HTTP: uploads, authenticated originals, actual model image parts, multi-turn retention, errors and WhatsApp cached downloads",
  { timeout: 120000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "crm-images-http-")),
      captured = [];
    let logs = "";
    const mock = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}");
      captured.push(body);
      if (raw.includes("FAIL_VISION")) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: {
              message: "Mock model does not support images",
              type: "invalid_request_error",
            },
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 1, model: "mock", choices: [{ index: 0, delta: { role: "assistant", content: "已看到测试图片，未发送客户消息。" }, finish_reason: null }] })}\n\n`,
      );
      res.write(
        `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 1, model: "mock", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    });
    await new Promise((r) => mock.listen(0, "127.0.0.1", r));
    const probe = createServer();
    await new Promise((r) => probe.listen(0, "127.0.0.1", r));
    const port = probe.address().port;
    await new Promise((r) => probe.close(r));
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
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATA_DIR: dir,
          APP_URL: base,
          ALLOW_LOCAL_AI: "1",
          HTTP_PROXY: "",
          HTTPS_PROXY: "",
          ALL_PROXY: "",
          WA_PROXY_URL: "direct",
          NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout.on("data", (d) => (logs += d));
    server.stderr.on("data", (d) => (logs += d));
    let cookie = "";
    const send = (body) => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const req = async (url, options = {}) => {
      const r = await fetch(base + url, {
        ...options,
        headers: { Origin: base, Cookie: cookie, ...options.headers },
      });
      if (r.headers.get("set-cookie"))
        cookie = r.headers.get("set-cookie").split(";")[0];
      const body = await r.json();
      return { status: r.status, body };
    };
    let db;
    try {
      for (let n = 0; n < 100; n++) {
        try {
          if ((await fetch(base + "/api/auth/setup")).ok) break;
        } catch {}
        if (n === 99) throw Error(logs.slice(-3000));
        await new Promise((r) => setTimeout(r, 200));
      }
      let r = await req(
        "/api/auth/setup",
        send({
          name: "Test Admin",
          email: "admin@example.test",
          password: "TestCRM2026!",
        }),
      );
      assert.equal(r.status, 200);
      const adminCookie = cookie;
      r = await req(
        "/api/customers",
        send({
          raw: "From: Alice <alice@example.test>\nSubject: Synthetic order\n\nPlease quote 2 units.",
        }),
      );
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const customerId = r.body.id,
        projectId = r.body.projects[0].id;
      const bytes = await sharp({
        create: { width: 60, height: 40, channels: 3, background: "#207564" },
      })
        .png()
        .toBuffer();
      const upload = async (
        customer = customerId,
        project = projectId,
        fileBytes = bytes,
      ) => {
        const form = new FormData();
        form.set("customerId", String(customer));
        form.set("projectId", String(project));
        form.set(
          "image",
          new File([fileBytes], "测试图片.png", { type: "image/png" }),
        );
        return req("/api/chat/images", { method: "POST", body: form });
      };
      r = await upload();
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const image = r.body.image;
      const original = await fetch(base + image.url, {
        headers: { Cookie: cookie },
      });
      assert.equal(original.status, 200);
      assert.equal(original.headers.get("cache-control"), "private, no-store");
      assert.equal(original.headers.get("content-type"), "image/webp");
      assert.equal((await fetch(base + image.url)).status, 401);
      assert.equal((await upload(customerId, 999)).status, 400);
      assert.equal(
        (await upload(customerId, projectId, Buffer.from("fake image"))).status,
        400,
      );
      r = await req(
        "/api/ai/providers",
        send({
          name: "Mock vision",
          providerKey: "custom",
          apiStyle: "chat",
          baseUrl: `http://127.0.0.1:${mock.address().port}/v1`,
          model: "mock-vision",
        }),
      );
      assert.equal(r.status, 200);
      await req("/api/ai/providers", {
        ...send({ id: r.body.id, active: true }),
        method: "PATCH",
      });
      const chat = async (message, images = []) => {
        const response = await fetch(base + "/api/chat", {
          ...send({ customerId, projectId, message, images }),
          headers: {
            Origin: base,
            Cookie: cookie,
            "Content-Type": "application/json",
          },
        });
        return { status: response.status, text: await response.text() };
      };
      let result = await chat("请分析我的测试图片", [image.id]);
      assert.equal(result.status, 200);
      assert.match(result.text, /"event":"done"/, result.text);
      assert.match(
        JSON.stringify(captured.at(-1).messages),
        /data:image\/webp;base64/,
        "actual image bytes must reach mock model",
      );
      result = await chat("继续参考刚才图片");
      assert.match(result.text, /"event":"done"/);
      assert.match(
        JSON.stringify(captured.at(-1).messages),
        /data:image\/webp;base64/,
        "followup preserves image context",
      );
      result = await chat("FAIL_VISION", [image.id]);
      assert.match(
        result.text,
        /支持图像输入/,
        "unsupported model error must explain capability",
      );
      r = await req(`/api/customers?id=${customerId}`);
      assert.ok(
        r.body.chat.some(
          (m) => m.role === "user" && JSON.parse(m.images).includes(image.id),
        ),
      );
      assert.equal(
        (await chat("too many", Array(5).fill(image.id))).status,
        400,
      );
      await req(
        "/api/users",
        send({
          name: "Other Sales",
          email: "sales@example.test",
          password: "SalesCRM2026!",
          role: "sales",
        }),
      );
      cookie = "";
      await req(
        "/api/auth/login",
        send({ email: "sales@example.test", password: "SalesCRM2026!" }),
      );
      assert.equal(
        (await fetch(base + image.url, { headers: { Cookie: cookie } })).status,
        404,
      );
      assert.equal((await upload()).status, 400);
      cookie = adminCookie;
      db = new DatabaseSync(path.join(dir, "rehabintl-crm.sqlite"));
      db.exec("PRAGMA busy_timeout=5000");
      const stored = "synthetic-wa.bin";
      writeFileSync(
        path.join(dir, "uploads", stored),
        Buffer.from("synthetic attachment"),
      );
      db.prepare(
        "INSERT INTO wa_contacts(jid,name,customer_id,selected) VALUES('15555550999@s.whatsapp.net','Synthetic',?,1)",
      ).run(customerId);
      const mediaId = Number(
        db
          .prepare(
            "INSERT INTO wa_messages(jid,message_key,body,kind,timestamp,raw_key,media_name,media_stored_name) VALUES('15555550999@s.whatsapp.net','cached','Synthetic','media',1000,'{}','测试附件.pdf',?)",
          )
          .run(stored).lastInsertRowid,
      );
      const download = await fetch(
        `${base}/api/files/${mediaId}?source=whatsapp&download=1`,
        { headers: { Cookie: cookie } },
      );
      assert.equal(download.status, 200);
      assert.equal(await download.text(), "synthetic attachment");
      assert.match(download.headers.get("content-disposition"), /^attachment;/);
      const inbox = await req(
        "/api/whatsapp/inbox?jid=15555550999%40s.whatsapp.net",
      );
      assert.ok(inbox.body.messages.some((m) => m.media_available));
      assert.ok(!JSON.stringify(inbox.body).includes("payload_cipher"));
    } finally {
      db?.close();
      server.kill();
      await new Promise((r) => server.once("exit", r));
      await new Promise((r) => mock.close(r));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
