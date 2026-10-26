import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import AdmZip from "adm-zip";

test(
  "V2 workspace: identities, projects, files, permissions, streaming tools, translation, backup",
  { timeout: 180000 },
  async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), "crm-v2-test-"));
    let logs = "";
    let translationCalls = 0;
    let toolCalls = 0;
    const mock = createServer(async (req, res) => {
      let raw = "";
      for await (const c of req) raw += c;
      const body = JSON.parse(raw || "{}");
      const messages = body.messages || [];
      const all = JSON.stringify(messages);
      const json = (content) => {
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            id: "mock",
            model: "crm-mock",
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
              completion_tokens: 10,
              total_tokens: 20,
            },
          }),
        );
      };
      if (body.stream) {
        res.setHeader("Content-Type", "text/event-stream");
        const chunk = (delta, finish_reason = null) =>
          res.write(
            `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", model: "crm-mock", created: 1, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
          );
        if (body.tools?.length && !messages.some((m) => m.role === "tool")) {
          toolCalls++;
          chunk({
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "search-1",
                type: "function",
                function: {
                  name: "search_materials",
                  arguments: JSON.stringify({ query: "KM-T20" }),
                },
              },
            ],
          });
          chunk({}, "tool_calls");
        } else {
          chunk({
            role: "assistant",
            content:
              "已读取历史，客户已确认 10 台。\n\nDear Anna, thank you. We will check the freight to Dubai.\n\n中文：感谢确认，我们将核算到迪拜的运费。",
          });
          chunk({}, "stop");
        }
        res.end("data: [DONE]\n\n");
        return;
      }
      if (all.includes("完整翻译")) {
        translationCalls++;
        return json("请报价 10 台 KM-T20，运往迪拜。");
      }
      if (
        all.includes("整理客户最新消息") ||
        all.includes("整理双方最新真实沟通")
      )
        return json(
          JSON.stringify({
            summary: "客户已确认10台，询问迪拜运费",
            product: "KM-T20",
            quantity: "10",
            destination: "Dubai",
            waiting_on: "我方",
            next_action: "核算迪拜运费",
            conflicts: [],
          }),
        );
      if (body.tool_choice) {
        res.setHeader("Content-Type", "application/json");
        return res.end(
          JSON.stringify({
            id: "probe",
            model: "crm-mock",
            created: 1,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "probe-1",
                      type: "function",
                      function: {
                        name: "connection_probe",
                        arguments: '{"code":"CRM"}',
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          }),
        );
      }
      return json(
        all.includes('"ok"') || all.includes("JSON对象")
          ? '{"ok":true}'
          : "连接成功",
      );
    });
    await new Promise((resolve) => mock.listen(0, "127.0.0.1", resolve));
    const mockPort = mock.address().port;
    const portProbe = createServer();
    await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
    const port = portProbe.address().port;
    await new Promise((resolve) => portProbe.close(resolve));
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
          DATA_DIR: dataDir,
          APP_URL: base,
          ALLOW_LOCAL_AI: "1",
          HTTP_PROXY: "",
          HTTPS_PROXY: "",
          ALL_PROXY: "",
          NODE_ENV: "production",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout.on("data", (d) => (logs += d));
    server.stderr.on("data", (d) => (logs += d));
    let cookie = "";
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
    const send = (d) => ({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(d),
    });
    try {
      for (let i = 0; i < 100; i++) {
        try {
          if ((await fetch(base + "/api/auth/setup")).ok) break;
        } catch {}
        await new Promise((r) => setTimeout(r, 300));
        if (i === 99) throw new Error(logs.slice(-4000));
      }
      let r = await req(
        "/api/auth/setup",
        send({
          name: "Review Admin",
          email: "admin@example.test",
          password: "TestingCRM2026!",
        }),
      );
      assert.equal(r.status, 200, JSON.stringify(r.body));
      const adminCookie = cookie;
      const raw =
        "From: Anna <anna@example.test>\nSubject: KM-T20 inquiry\n\nPlease quote 10 units KM-T20 to Dubai.\nAnna\nExample Clinic";
      r = await req("/api/customers", send({ raw }));
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const customerId = r.body.id;
      const projectId = r.body.projects[0].id;
      r = await req("/api/customers", send({ raw }));
      assert.equal(r.body.id, customerId);
      assert.equal(r.body.existing, true);
      assert.equal(r.body.projects.length, 1);
      r = await req(
        "/api/customers",
        send({ raw, customerId, newProject: true, subject: "Second order" }),
      );
      assert.equal(r.body.projects.length, 2);
      assert.equal((await req("/api/customers")).body.customers.length, 1);
      r = await req(
        "/api/customers",
        send({
          name: "Phone only",
          phone: "+971 50 1234567",
          raw: "We need a product catalogue.",
          channel: "whatsapp",
        }),
      );
      assert.equal(r.body.customer.email, "");
      const phoneId = r.body.id;
      r = await req(
        "/api/customers",
        send({
          name: "Phone only again",
          phone: "00971501234567",
          raw: "Quantity is five",
          channel: "whatsapp",
        }),
      );
      assert.equal(r.body.id, phoneId);
      async function upload(name, content, scope = "company", cid) {
        const f = new FormData();
        f.append("files", new File([content], name, { type: "text/plain" }));
        f.append("scope", scope);
        if (cid) f.append("customerId", cid);
        const r = await req("/api/knowledge", { method: "POST", body: f });
        assert.equal(r.status, 200, JSON.stringify(r.body));
        return r.body.files[0].id;
      }
      const fileId = await upload(
        "KM-T20-product.md",
        "KM-T20 gait trainer. Product catalogue for rehabilitation projects. Customer approved model.",
      );
      const duplicate = await upload(
        "KM-T20-copy.md",
        "KM-T20 gait trainer. Product catalogue for rehabilitation projects. Customer approved model.",
      );
      assert.equal(duplicate, fileId, "duplicate content reused");
      const internalId = await upload(
        "internal-KM-T20-price.md",
        "Internal supplier cost KM-T20 123. Never send this file to customers.",
        "internal",
      );
      const zip = new AdmZip();
      zip.addFile(
        "catalog/KM-T20-catalog.txt",
        Buffer.from(
          "KM-T20 product catalogue original archive file for customer review.",
        ),
      );
      zip.addFile(".env.local", Buffer.from("SECRET=do-not-import"));
      const zipId = await upload("project.zip", zip.toBuffer());
      let files = [];
      for (let i = 0; i < 80; i++) {
        files = (await req("/api/knowledge")).body.files;
        if (files.every((f) => !["queued", "processing"].includes(f.status)))
          break;
        await new Promise((r) => setTimeout(r, 150));
      }
      assert.equal(files.length, 3);
      assert.ok(
        files.every((f) => f.status === "ready"),
        JSON.stringify(files),
      );
      const original = await fetch(base + `/api/files/${zipId}`, {
        headers: { Cookie: cookie },
      });
      assert.equal(original.status, 200);
      assert.match(await original.text(), /original archive file/);
      const version2 = await upload(
        "KM-T20-product.md",
        "KM-T20 updated catalogue original version two, revised model specifications.",
      );
      assert.notEqual(version2, fileId);
      files = (await req("/api/knowledge")).body.files;
      assert.equal(files.find((f) => f.id === fileId).is_current, 0);
      assert.equal(files.find((f) => f.id === version2).version, 2);
      r = await req(
        "/api/users",
        send({
          name: "Sales",
          email: "sales@example.test",
          password: "SalesCRM2026!",
          role: "sales",
        }),
      );
      assert.equal(r.status, 201, JSON.stringify(r.body));
      const salesId = (await req("/api/users")).body.users.find(
        (u) => u.email === "sales@example.test",
      ).id;
      cookie = "";
      r = await req(
        "/api/auth/login",
        send({ email: "sales@example.test", password: "SalesCRM2026!" }),
      );
      assert.equal(r.status, 200);
      const salesCookie = cookie;
      assert.equal((await req("/api/customers")).body.customers.length, 0);
      assert.equal((await req(`/api/customers?id=${customerId}`)).status, 404);
      assert.equal(
        (
          await fetch(base + `/api/files/${internalId}`, {
            headers: { Cookie: cookie },
          })
        ).status,
        404,
      );
      cookie = adminCookie;
      r = await req("/api/customers", {
        ...send({ id: customerId, action: "grant", userId: salesId }),
        method: "PATCH",
      });
      assert.equal(r.status, 200);
      cookie = salesCookie;
      assert.equal((await req("/api/customers")).body.customers.length, 1);
      cookie = adminCookie;
      await req("/api/customers", {
        ...send({
          id: customerId,
          action: "memory",
          projectId,
          content: "客户数量已经确认10台，不再重复询问。",
        }),
        method: "PATCH",
      });
      r = await req(
        "/api/ai/providers",
        send({
          name: "Test provider",
          providerKey: "custom",
          apiStyle: "chat",
          baseUrl: `http://127.0.0.1:${mockPort}/v1`,
          model: "crm-mock",
        }),
      );
      assert.equal(r.status, 200);
      const providerId = r.body.id;
      for (const capability of ["text", "stream", "tools", "structured"]) {
        const probe = await req(
          "/api/ai/capabilities",
          send({ id: providerId, capability }),
        );
        assert.equal(
          probe.status,
          200,
          `${capability}: ${JSON.stringify(probe.body)}`,
        );
      }
      const route = await req("/api/ai/tasks", {
        ...send({ task: "translation", providerId }),
        method: "PATCH",
      });
      assert.equal(route.status, 200);
      await req("/api/ai/providers", {
        ...send({ id: providerId, active: true }),
        method: "PATCH",
      });
      const stream = await fetch(base + "/api/chat", {
        ...send({
          customerId,
          projectId,
          message: "Please prepare reply and find KM-T20 catalogue",
        }),
        headers: {
          "Content-Type": "application/json",
          Origin: base,
          Cookie: cookie,
        },
      });
      assert.equal(stream.status, 200);
      const output = await stream.text();
      assert.match(output, /"event":"delta"/);
      assert.match(output, /"event":"done"/);
      assert.doesNotMatch(output, /"event":"error"/);
      assert.ok(toolCalls > 0);
      r = await req(`/api/customers?id=${customerId}`);
      assert.ok(
        r.body.chat.some(
          (m) => m.role === "assistant" && m.status === "complete",
        ),
      );
      const assistant = r.body.chat.find((m) => m.role === "assistant");
      assert.ok(JSON.parse(assistant.sources).some((f) => f.canAttach));
      assert.ok(
        JSON.parse(assistant.sources)
          .filter((f) => f.fileId === internalId)
          .every((f) => !f.canAttach),
      );
      const messageId = r.body.messages[0].id;
      await req(
        "/api/messages",
        send({ action: "translate", customerId, messageId }),
      );
      await req(
        "/api/messages",
        send({ action: "translate", customerId, messageId }),
      );
      assert.equal(translationCalls, 1, "translation cached");
      r = await req(
        "/api/progress",
        send({ action: "analyze", customerId, projectId }),
      );
      assert.equal(r.status, 200);
      r = await req(`/api/customers?id=${customerId}`);
      assert.ok(r.body.suggestions.length);
      const suggestion = r.body.suggestions.find(
        (s) => s.project_id === projectId,
      );
      assert.ok(suggestion);
      await req(
        "/api/progress",
        send({ action: "apply", customerId, suggestionId: suggestion.id }),
      );
      r = await req(`/api/customers?id=${customerId}`);
      assert.equal(
        r.body.projects.find((p) => p.id === projectId).quantity,
        "10",
      );
      r = await req(
        "/api/messages",
        send({
          customerId,
          projectId,
          body: "Draft not sent",
          status: "draft",
        }),
      );
      assert.equal(r.body.status, "draft");
      const csv = new FormData();
      csv.append(
        "file",
        new File(
          [
            "姓名,邮箱,电话,公司,国家,来源\n历史客户,history@example.test,,历史示例公司,China,展会\n缺身份,,,,,\n",
          ],
          "customers.csv",
          { type: "text/csv" },
        ),
      );
      const csvImport = await req("/api/customers/import", {
        method: "POST",
        body: csv,
      });
      assert.equal(csvImport.status, 200);
      assert.equal(csvImport.body.imported, 2);
      r = await req("/api/whatsapp");
      assert.equal(r.body.status, "disconnected");
      assert.equal(r.body.verified, false);
      assert.equal(
        r.body.range.total,
        0,
        "manual WhatsApp examples are not counted as synchronized messages",
      );
      r = await req("/api/whatsapp", send({ action: "cancel" }));
      assert.equal(r.status, 200);
      assert.equal(r.body.status, "disconnected");
      assert.match(r.body.error, /已停止/);
      r = await req("/api/whatsapp", send({ action: "connect" }));
      assert.equal(r.status, 400, "cannot connect without risk consent");
      r = await req(
        "/api/backups",
        send({ passphrase: "WorkspaceBackup2026!" }),
      );
      assert.equal(r.status, 200, JSON.stringify(r.body));
      console.log(
        "V2 integration passed: customer dedup, phone identity, projects, async files/ZIP originals/versions, permissions, AI tool stream, memory, translation cache, progress review, send status, backup, WhatsApp gating.",
      );
    } finally {
      server.kill();
      await new Promise((r) => setTimeout(r, 600));
      await new Promise((resolve) => mock.close(resolve));
      try {
        rmSync(dataDir, { recursive: true, force: true });
      } catch {}
      if (server.exitCode && !logs.includes("Ready"))
        console.error(logs.slice(-2000));
    }
  },
);
