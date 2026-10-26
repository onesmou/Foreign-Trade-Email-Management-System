import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  inspectBundle,
  applyBundle,
  containedFile,
} from "../scripts/lib/codex-migration.mjs";
import {
  historicalLink,
  historicalMessage,
} from "../lib/codex-history-format.ts";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (
      specifier.startsWith(".") &&
      context.parentURL?.includes("/lib/") &&
      !context.parentURL.includes("/node_modules/") &&
      !path.extname(specifier)
    )
      return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
    return next(specifier, context);
  },
});
test("Codex migration is preview-first, idempotent, evidence-preserving and atomically rolled back", async () => {
  assert.equal(
    historicalLink("C:/Users/ABC/customer/README.md", []),
    undefined,
  );
  assert.equal(historicalLink("javascript:alert(1)", []), undefined);
  assert.equal(
    historicalLink("source-files/mail.md", [
      { id: 7, original_path: "source-files/mail.md" },
    ]),
    "/api/files/7",
  );
  assert.equal(
    historicalMessage(
      "# Files mentioned by the user:\nfile.pdf\n## My request:\n请帮我看询盘",
      "user",
    ).text,
    "请帮我看询盘",
  );
  const dir = mkdtempSync(path.join(tmpdir(), "crm-codex-test-")),
    source = path.join(dir, "source");
  process.env.DATA_DIR = path.join(dir, "data");
  mkdirSync(source);
  const { getDb } = await import("../lib/db.ts");
  const db = getDb();
  try {
    db.prepare(
      "INSERT INTO users(id,name,email,password_hash,role) VALUES(1,'Synthetic Admin','import@example.test','fake','admin')",
    ).run();
    const files = [
      {
        path: "customer-record.md",
        content: "Synthetic customer requires DEMO-X, approved quantity one.",
        scope: "customer",
        role: "reference",
        indexText: true,
      },
      {
        path: "source-files/masked.pdf",
        content: "%PDF-1.4 synthetic masked file, never parsed",
        scope: "customer",
        role: "incoming",
        originalOnly: true,
      },
      {
        path: "working-files/cost.md",
        content: "Internal illustrative cost only, never a customer quotation.",
        scope: "internal",
        role: "internal",
      },
      {
        path: "email-drafts/v1-en.txt",
        content: "Superseded draft, never proof of sending.",
        scope: "customer",
        role: "draft",
      },
    ].map((f) => {
      const absolute = path.join(source, f.path);
      mkdirSync(path.dirname(absolute), { recursive: true });
      writeFileSync(absolute, f.content);
      return {
        ...f,
        content: undefined,
        sha256: createHash("sha256").update(f.content).digest("hex"),
        canSend: false,
      };
    });
    const bundle = {
      format: "crm-codex-migration-v1",
      source: {
        threadId: "00000000-0000-4000-8000-000000000001",
        title: "Synthetic customer conversation",
        coverage: { hasMore: false, turns: 1, visibleMessages: 3 },
      },
      customer: {
        name: "Synthetic buyer",
        email: "buyer@example.test",
        phone: "+15555550101",
        company: "Example Ltd",
        country: "Test",
      },
      project: { title: "DEMO-X order", stage: "方案准备" },
      items: [
        {
          id: "user-1",
          turnId: "turn-1",
          role: "user",
          phase: "",
          body: "Please prepare a reply, do not send.",
          recordedAt: "2026-10-24T12:00:00Z",
        },
        {
          id: "assistant-progress",
          turnId: "turn-1",
          role: "assistant",
          phase: "commentary",
          body: "Preparing a draft.",
          recordedAt: "2026-10-24T12:00:00Z",
        },
        {
          id: "assistant-1",
          turnId: "turn-1",
          role: "assistant",
          phase: "final_answer",
          body: "Here is a draft, not evidence of sending.",
          recordedAt: "2026-10-24T12:00:00Z",
        },
      ],
      messages: [
        {
          id: "incoming",
          direction: "inbound",
          status: "received",
          body: "Please quote DEMO-X.",
          sourceRef: "screenshot transcription, not EML",
          recordedAt: "2026-10-24T12:00:00Z",
          occurredLabel: "截图显示21:00，时区未核实",
        },
        {
          id: "reply",
          direction: "outbound",
          status: "presumed_sent",
          body: "We are preparing a quotation.",
          sourceRef: "user habit, no delivery receipt",
          occurredLabel: "推定采用/发送，实际发送时间未记录",
        },
      ],
      memories: [
        {
          content: "DEMO-X quantity one; no approved quotation.",
          sourceRef: "verified customer record",
          evidenceMessageId: "incoming",
        },
      ],
      files,
    };
    const plan = inspectBundle(db, bundle, source, 1);
    plan.sourceRoot = source;
    assert.equal(plan.summary.files, 4);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM customers").get().n,
      0,
      "dry run does not write",
    );
    const result = applyBundle(db, plan, process.env.DATA_DIR, 1);
    assert.equal(result.reused, false);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM customers").get().n, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM assistant_messages").get().n,
      0,
      "historical discussion is not silently inserted into active AI conversation",
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM imported_chat_items").get().n,
      3,
    );
    assert.equal(
      db.prepare("SELECT stage FROM projects WHERE id=?").get(result.projectId)
        .stage,
      "方案准备",
    );
    assert.equal(
      db
        .prepare(
          "SELECT COUNT(*) n FROM communications WHERE send_status IN ('confirmed_sent','manual_sent')",
        )
        .get().n,
      0,
    );
    assert.equal(
      db
        .prepare(
          "SELECT occurred_label FROM communications WHERE send_status='presumed_sent'",
        )
        .get().occurred_label,
      "推定采用/发送，实际发送时间未记录",
    );
    const pdf = db
      .prepare("SELECT * FROM knowledge_files WHERE original_name='masked.pdf'")
      .get();
    assert.equal(pdf.index_policy, "original_only");
    assert.equal(pdf.chunk_count, 0);
    assert.equal(pdf.can_send, 0);
    assert.equal(
      db
        .prepare(
          "SELECT is_current FROM knowledge_files WHERE original_name='v1-en.txt'",
        )
        .get().is_current,
      0,
    );
    assert.equal(
      db
        .prepare("SELECT COUNT(*) n FROM knowledge_files WHERE can_send=1")
        .get().n,
      0,
      "reference files are not approved sending attachments",
    );
    const second = inspectBundle(db, bundle, source, 1);
    second.sourceRoot = source;
    assert.equal(applyBundle(db, second, process.env.DATA_DIR, 1).reused, true);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM projects").get().n, 1);
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM knowledge_files").get().n,
      4,
    );
    const altered = structuredClone(bundle);
    altered.items[0].body += " Changed";
    assert.throws(() => inspectBundle(db, altered, source, 1), /不同快照/);
    const incomplete = structuredClone(bundle);
    incomplete.source.coverage.hasMore = true;
    assert.throws(
      () => inspectBundle(db, incomplete, source, 1),
      /分页尚未读取完成/,
    );
    assert.throws(() => containedFile(source, "../outside.txt"), /路径无效/);
    assert.throws(() => containedFile(source, "auth.json"), /密钥目录/);
    const falseSent = structuredClone(bundle);
    falseSent.messages[1].status = "confirmed_sent";
    assert.throws(
      () => inspectBundle(db, falseSent, source, 1),
      /伪造确认发送/,
    );
    const leak = structuredClone(bundle);
    leak.files[2].scope = "customer";
    assert.throws(() => inspectBundle(db, leak, source, 1), /内部文件/);
    const next = structuredClone(bundle);
    next.source.threadId = "00000000-0000-4000-8000-000000000002";
    next.customer.email = "second@example.test";
    next.customer.phone = "+15555550102";
    const nextPlan = inspectBundle(db, next, source, 1);
    nextPlan.sourceRoot = source;
    const originalFiles = readdirSync(
      path.join(process.env.DATA_DIR, "uploads"),
    );
    db.exec(
      "CREATE TRIGGER fail_import BEFORE INSERT ON knowledge_files BEGIN SELECT RAISE(ABORT,'synthetic failure'); END",
    );
    assert.throws(
      () => applyBundle(db, nextPlan, process.env.DATA_DIR, 1),
      /synthetic failure/,
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) n FROM customers").get().n,
      1,
      "partial import rolled back",
    );
    assert.deepEqual(
      readdirSync(path.join(process.env.DATA_DIR, "uploads")),
      originalFiles,
      "only newly created copies were cleaned up",
    );
    db.exec("DROP TRIGGER fail_import");
    db.prepare("INSERT INTO customers(name,email,phone,owner_id) VALUES('Unrelated synthetic buyer','conflict@example.test','+15555550999',1)").run();
    const conflict=structuredClone(bundle);conflict.customer.phone="+15555550999";
    assert.throws(()=>inspectBundle(db,conflict,source,1),/对应不同客户/);
    writeFileSync(
      path.join(source, "customer-record.md"),
      "tampered after snapshot",
    );
    assert.throws(() => inspectBundle(db, bundle, source, 1), /快照不一致/);
  } finally {
    db.close();
    global.__rehabCrmDb = undefined;
    rmSync(dir, { recursive: true, force: true });
  }
});
