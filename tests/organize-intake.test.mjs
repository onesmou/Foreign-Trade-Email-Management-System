import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const listen = (server) =>
  new Promise((r) =>
    server.listen(0, "127.0.0.1", () => r(server.address().port)),
  );
const send = (body, method = "POST") => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
function blankPdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << >> /Contents 4 0 R >>",
    "<< /Length 4 >>\nstream\nq\nQ\nendstream",
  ];
  let s = "%PDF-1.4\n",
    offsets = [0];
  for (const [i, o] of objects.entries()) {
    offsets.push(Buffer.byteLength(s));
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
  }
  const start = Buffer.byteLength(s);
  s += `xref\n0 5\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
    .join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(s);
}
test(
  "content-based AI folders, private access, intake source attribution and WhatsApp inbox API",
  { timeout: 150000 },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "crm-organize-test-"));
    let textCalls = 0,
      visionCalls = 0;
    const mock = createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      const body = JSON.parse(raw || "{}"),
        all = JSON.stringify(body);
      if (all.includes("FAIL_AI")) {
        res.writeHead(503, { "Content-Type": "application/json" });
        return res.end('{"error":{"message":"mock AI unavailable"}}');
      }
      if (all.includes("SLOW_AI")) await wait(500);
      let content = "中文翻译：请报价。";
      if (all.includes("公司资料整理员")) {
        const vision =
          all.includes("image_url") ||
          all.includes("input_image") ||
          all.includes("input_file");
        vision ? visionCalls++ : textCalls++;
        content = JSON.stringify({
          company: "Demo Medical",
          product: "KM-T20",
          category: vision ? "产品图片" : "产品说明",
          title: vision ? "步态训练器示意图" : "KM-T20 产品说明",
          summary: "演示公司 KM-T20 步态训练器资料",
          confidence: all.includes("UNCERTAIN") ? 0.4 : 0.96,
          reason: "正文明确包含 Demo Medical 和 KM-T20；测试模拟结果",
          internal: all.includes("PRIVATE_COST"),
          extracted_text: vision
            ? "Demo Medical KM-T20 gait trainer, simulated visual extraction"
            : "",
        });
      }
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify(
          req.url.includes("responses")
            ? {
                id: "mock",
                object: "response",
                status: "completed",
                model: "mock",
                output: [
                  {
                    type: "message",
                    id: "m",
                    role: "assistant",
                    status: "completed",
                    content: [
                      { type: "output_text", text: content, annotations: [] },
                    ],
                  },
                ],
                usage: {
                  input_tokens: 10,
                  output_tokens: 20,
                  total_tokens: 30,
                },
              }
            : {
                id: "mock",
                model: "mock",
                created: 1,
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 20,
                  total_tokens: 30,
                },
              },
        ),
      );
    });
    const mockPort = await listen(mock),
      probe = createServer(),
      port = await listen(probe);
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
          CRM_PREVIEW: "0",
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let logs = "",
      cookie = "";
    server.stdout.on("data", (c) => (logs += c));
    server.stderr.on("data", (c) => (logs += c));
    const req = async (url, options = {}) => {
      const r = await fetch(base + url, {
        ...options,
        headers: { Cookie: cookie, Origin: base, ...options.headers },
      });
      if (r.headers.get("set-cookie"))
        cookie = r.headers.get("set-cookie").split(";")[0];
      const body = await r.json();
      return { status: r.status, body };
    };
    async function upload(
      name,
      content,
      { auto = true, scope = "company", customerId, folderId } = {},
    ) {
      const f = new FormData();
      f.append("files", new File([content], name));
      f.append("scope", scope);
      f.append("autoOrganize", String(auto));
      if (customerId) f.append("customerId", String(customerId));
      if (folderId) f.append("folderId", String(folderId));
      const r = await req("/api/knowledge", { method: "POST", body: f });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.files[0].id;
    }
    async function fileReady(id) {
      for (let i = 0; i < 100; i++) {
        const d = (await req("/api/knowledge")).body;
        const f = d.files.find((f) => f.id === id);
        if (f && !["queued", "processing"].includes(f.status)) return f;
        await wait(80);
      }
      throw new Error("File processing timed out");
    }
    let db;
    try {
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(base + "/api/auth/setup")).ok) break;
        } catch {}
        await wait(200);
        if (i === 99) throw new Error(logs.slice(-2500));
      }
      assert.equal(
        (
          await req(
            "/api/auth/setup",
            send({
              name: "Synthetic Admin",
              email: "organize@example.test",
              password: "TestingCRM2026!",
            }),
          )
        ).status,
        200,
      );
      const adminCookie = cookie;
      let p = await req(
        "/api/ai/providers",
        send({
          name: "Mock classify",
          providerKey: "custom",
          apiStyle: "chat",
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          model: "mock",
        }),
      );
      await req(
        "/api/ai/providers",
        send({ id: p.body.id, active: true }, "PATCH"),
      );
      const fileId = await upload(
        "æ乱码-98x.md",
        "Demo Medical KM-T20 gait trainer. Product description for rehabilitation.",
      );
      let f = await fileReady(fileId);
      assert.equal(f.organize_status, "已归类");
      assert.equal(f.folder_path, "Demo Medical / KM-T20 / 产品说明");
      assert.equal(f.original_name, "æ乱码-98x.md");
      assert.equal(f.display_name, "KM-T20 产品说明");
      assert.equal(f.status, "ready");
      assert.ok(textCalls > 0);
      const original = await fetch(base + `/api/files/${fileId}`, {
        headers: { Cookie: cookie },
      });
      assert.match(await original.text(), /Demo Medical KM-T20/);
      const uncertain = await upload(
        "nothing.txt",
        "UNCERTAIN: a mixed unknown document with no reliable company.",
      );
      assert.equal((await fileReady(uncertain)).folder_path, "待确认");
      const failed = await upload(
        "unknown-2.txt",
        "FAIL_AI Demo Medical KM-T20 file, fallback still indexes readable content.",
      );
      f = await fileReady(failed);
      assert.equal(f.organize_status, "识别失败");
      assert.equal(
        f.status,
        "ready",
        "local searchable text survives model failure",
      );
      assert.equal(f.folder_path, "待确认");
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=",
        "base64",
      );
      const image = await upload("xx-图片.png", png);
      f = await fileReady(image);
      assert.equal(f.organize_status, "已归类");
      assert.ok(
        visionCalls > 0,
        "image content was sent through the multimodal API, not only its filename",
      );
      const visionProvider = await req(
        "/api/ai/providers",
        send({
          name: "Mock vision Responses",
          providerKey: "custom",
          apiStyle: "responses",
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          model: "mock",
        }),
      );
      await req(
        "/api/ai/tasks",
        send({ task: "vision", providerId: visionProvider.body.id }, "PATCH"),
      );
      const pdf = await upload("扫描件-random.pdf", blankPdf());
      f = await fileReady(pdf);
      assert.equal(
        f.organize_status,
        "已归类",
        JSON.stringify({
          status: f.status,
          reason: f.organize_reason,
          error: f.error,
        }),
      );
      assert.equal(f.organize_provider, "Mock vision Responses");
      const internal = await upload(
        "innocent-title.md",
        "PRIVATE_COST Demo Medical KM-T20 supplier internal cost details.",
      );
      assert.equal(
        (await fileReady(internal)).scope,
        "internal",
        "AI may reduce but not expand visibility",
      );
      const root = (
        await req("/api/folders", send({ name: "人工整理", scope: "company" }))
      ).body.id;
      const child = (
        await req(
          "/api/folders",
          send({ name: "图片", scope: "company", parentId: root }),
        )
      ).body.id;
      assert.equal(
        (
          await req(
            "/api/folders",
            send({ id: root, name: "人工整理", parentId: child }, "PATCH"),
          )
        ).status,
        400,
        "reject folder cycle",
      );
      assert.equal(
        (await req("/api/folders", send({ fileId, folderId: root }, "PATCH")))
          .status,
        200,
      );
      f = (await req("/api/knowledge")).body.files.find((f) => f.id === fileId);
      assert.equal(f.manual_folder, 1);
      assert.equal(f.folder_path, "人工整理");
      const slow = await upload(
        "slow-unordered.txt",
        "SLOW_AI Demo Medical KM-T20 content for manual override race test.",
      );
      await req(
        "/api/folders",
        send({ fileId: slow, folderId: root }, "PATCH"),
      );
      f = await fileReady(slow);
      assert.equal(f.folder_path, "人工整理");
      assert.equal(
        f.manual_folder,
        1,
        "manual placement wins over an in-flight AI result",
      );
      assert.equal(
        (
          await req(
            "/api/folders",
            send({ fileId: internal, folderId: root }, "PATCH"),
          )
        ).status,
        400,
        "no cross-scope move",
      );
      let r = await req(
        "/api/intake-sources",
        send({
          name: "Demo inquiry",
          source: "advertisement",
          campaign: "Google-Test",
        }),
      );
      assert.equal(r.status, 200);
      const entry = r.body;
      assert.ok(entry.secret);
      assert.ok(
        !(await req("/api/intake-sources")).body.sources[0].secret_cipher,
      );
      const payload = {
        requestId: "00000000-0000-4000-8000-000000000001",
        name: "Web Customer",
        email: "web@example.test",
        message: "Please quote the KM-T20 product.",
      };
      let publicResponse = await fetch(
        base + `/api/intake/${entry.id}`,
        send(payload),
      );
      assert.equal(
        publicResponse.status,
        400,
        "anonymous submissions require a valid form token",
      );
      const webSend = () =>
        fetch(base + `/api/intake/${entry.id}`, {
          ...send(payload),
          headers: {
            "Content-Type": "application/json",
            "x-intake-secret": entry.secret,
            "x-real-ip": "192.0.2.1",
          },
        });
      assert.equal((await webSend()).status, 202);
      assert.equal((await webSend()).status, 202);
      const customer = (await req("/api/customers")).body.customers.find(
        (c) => c.email === "web@example.test",
      );
      assert.equal(customer.first_source, "advertisement");
      assert.equal(customer.campaign, "Google-Test");
      const detail = (await req(`/api/customers?id=${customer.id}`)).body;
      assert.equal(
        detail.messages.length,
        1,
        "same submission retry is idempotent",
      );
      const formData = await (
        await fetch(base + `/api/intake/${entry.id}`)
      ).json();
      await wait(1550);
      publicResponse = await fetch(base + `/api/intake/${entry.id}`, {
        ...send({
          ...payload,
          requestId: "00000000-0000-4000-8000-000000000002",
          token: formData.token,
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: base,
          "x-real-ip": "192.0.2.2",
        },
      });
      assert.equal(
        publicResponse.status,
        202,
        "public browser form token accepted",
      );
      assert.equal(
        (await req("/api/customers")).body.customers.filter(
          (c) => c.email === "web@example.test",
        ).length,
        1,
        "repeat email reuses existing customer",
      );
      db = new DatabaseSync(path.join(dir, "rehabintl-crm.sqlite"));
      db.prepare(
        "INSERT INTO conversation_imports(id,source_system,thread_id,source_title,source_hash,customer_id,project_id,coverage,imported_by) VALUES('synthetic-import','codex','synthetic-thread','Synthetic history','hash',?,?,?,1)",
      ).run(
        customer.id,
        detail.projects[0].id,
        JSON.stringify({ hasMore: false, turns: 1, visibleMessages: 1 }),
      );
      db.prepare(
        "INSERT INTO imported_chat_items(import_id,source_item_id,source_turn_id,ordinal,role,phase,body,recorded_at) VALUES('synthetic-import','item','turn',0,'assistant','final_answer','Synthetic draft, not a sent message.','2026-10-24T12:00:00Z')",
      ).run();
      let importedHistory = await req(
        `/api/imported-conversations?customerId=${customer.id}`,
      );
      assert.equal(importedHistory.status, 200);
      assert.equal(importedHistory.body.items.length, 1);
      assert.match(importedHistory.body.items[0].body, /not a sent message/);
      assert.equal(
        (
          await req(
            `/api/imported-conversations?customerId=${customer.id}&projectId=999999&id=synthetic-import`,
          )
        ).status,
        404,
        "cannot read history from a different project",
      );
      db.prepare(
        "UPDATE knowledge_files SET index_policy='original_only',can_send=0 WHERE id=?",
      ).run(pdf);
      assert.equal(
        (
          await req(
            "/api/library",
            send({ id: pdf, retry: true, organize: true }, "PATCH"),
          )
        ).status,
        400,
        "masked PDF cannot be accidentally reindexed",
      );
      const jid = "15555550123@s.whatsapp.net";
      db.prepare(
        "INSERT INTO wa_contacts(jid,name) VALUES(?,'Synthetic WhatsApp')",
      ).run(jid);
      db.prepare(
        "INSERT INTO wa_messages(jid,message_key,body,timestamp,raw_key) VALUES(?,'fixture-message','Please quote.',1000,'{}')",
      ).run(jid);
      assert.equal(
        (await req("/api/whatsapp/inbox")).body.contacts[0].incoming,
        1,
      );
      r = await req(
        "/api/whatsapp/inbox",
        send({ action: "adopt", jid, customerId: customer.id }),
      );
      assert.equal(r.body.customerId, customer.id);
      assert.equal(
        (await req(`/api/customers?id=${customer.id}`)).body.messages.filter(
          (m) => m.channel === "whatsapp",
        ).length,
        1,
      );
      assert.equal(
        (
          await req(
            "/api/whatsapp/inbox",
            send({ action: "adopt", jid, customerId: customer.id }),
          )
        ).body.customerId,
        customer.id,
      );
      assert.equal(
        (
          await req(
            "/api/whatsapp/inbox",
            send({
              action: "send",
              jid,
              body: "Do not really send",
              requestId: "00000000-0000-4000-8000-000000000003",
              confirmed: true,
            }),
          )
        ).status,
        400,
        "disconnected send does not submit anything",
      );
      assert.equal(db.prepare("SELECT COUNT(*) n FROM wa_outbox").get().n, 0);
      cookie = "";
      assert.equal((await req("/api/whatsapp/inbox")).status, 401);
      cookie = adminCookie;
      await req(
        "/api/intake-sources",
        send({ id: entry.id, enabled: false }, "PATCH"),
      );
      assert.equal((await fetch(base + `/api/intake/${entry.id}`)).status, 404);
      const customerPrivate = await upload(
        "customer-only.txt",
        "Demo Medical KM-T20 private customer requirements, explicit scope.",
        { scope: "customer", customerId: customer.id },
      );
      assert.equal((await fileReady(customerPrivate)).scope, "customer");
      await req(
        "/api/users",
        send({
          name: "Unrelated sales",
          email: "other@example.test",
          password: "TestingCRM2026!",
          role: "sales",
        }),
      );
      cookie = "";
      await req(
        "/api/auth/login",
        send({ email: "other@example.test", password: "TestingCRM2026!" }),
      );
      const listing = (await req("/api/knowledge")).body;
      assert.ok(
        !listing.files.some(
          (f) => f.id === internal || f.id === customerPrivate,
        ),
      );
      assert.ok(
        !listing.folders.some(
          (f) => f.scope === "internal" || f.scope === "customer",
        ),
      );
      assert.equal((await req("/api/whatsapp/inbox")).status, 403);
      assert.equal((await req("/api/intake-sources")).status, 403);
      assert.equal(
        (await req(`/api/imported-conversations?customerId=${customer.id}`))
          .status,
        403,
        "private Codex discussions remain admin-only",
      );
      assert.ok(
        !listing.files.some((f) => f.id === uncertain || f.id === failed),
        "unconfirmed automatic imports are visible only to uploader/admin",
      );
      assert.equal(
        (
          await fetch(base + `/api/files/${failed}`, {
            headers: { Cookie: cookie },
          })
        ).status,
        404,
      );
      console.log(
        "New feature integration passed using isolated data and a mock AI service; no real WhatsApp messages sent.",
      );
    } finally {
      db?.close();
      server.kill();
      await wait(500);
      await new Promise((r) => mock.close(r));
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
      if (server.exitCode && !logs.includes("Ready"))
        console.error(logs.slice(-2000));
    }
  },
);
