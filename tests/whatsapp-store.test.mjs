import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (
      specifier.startsWith(".") &&
      context.parentURL?.includes("/lib/") &&
      !path.extname(specifier)
    )
      return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
    return next(specifier, context);
  },
});
test("WhatsApp inbox stores unlinked chats, links history once and sends only once through a mock transport", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "crm-wa-unit-"));
  process.env.DATA_DIR = dir;
  const { getDb } = await import("../lib/db.ts"),
    { saveInboxMessage, archiveInbox, sendOnce, updateDelivery } =
      await import("../lib/whatsapp-store.ts");
  const db = getDb();
  try {
    db.prepare(
      "INSERT INTO users(id,name,email,password_hash,role) VALUES(1,'Mock admin','wa@example.test','not-a-real-password','admin')",
    ).run();
    const jid = "15555550123@s.whatsapp.net";
    db.prepare(
      "INSERT INTO wa_contacts(jid,name) VALUES(?,'Synthetic contact')",
    ).run(jid);
    saveInboxMessage({
      jid,
      key: "incoming-1",
      fromMe: false,
      body: "Synthetic request for KM-T20",
      timestamp: 1000,
      rawKey: { remoteJid: jid, id: "incoming-1", fromMe: false },
    });
    assert.equal(db.prepare("SELECT count(*) n FROM wa_messages").get().n, 1);
    assert.equal(
      db.prepare("SELECT count(*) n FROM customers").get().n,
      0,
      "private contacts are not automatically customers",
    );
    db.prepare(
      "INSERT INTO customers(id,name,email,owner_id) VALUES(1,'Synthetic customer','synthetic@example.test',1)",
    ).run();
    db.prepare(
      "UPDATE wa_contacts SET customer_id=1,selected=1 WHERE jid=?",
    ).run(jid);
    archiveInbox(jid);
    archiveInbox(jid);
    assert.equal(
      db.prepare("SELECT count(*) n FROM communications").get().n,
      1,
    );
    let count = 0;
    const send = async (_jid, _text, messageId) => {
      count++;
      await new Promise((r) => setTimeout(r, 15));
      return { key: { id: messageId } };
    };
    const input = {
      requestId: "10000000-0000-4000-8000-000000000001",
      jid,
      body: "Synthetic reply, never sent to WhatsApp",
      userId: 1,
    };
    const [sent, duplicate] = await Promise.all([
      sendOnce(input, send),
      sendOnce(input, send),
    ]);
    assert.equal(count, 1);
    assert.equal(sent.status, "accepted");
    assert.equal(duplicate.status, "sending");
    updateDelivery(jid, sent.message_key, "read");
    updateDelivery(jid, sent.message_key, "delivered");
    assert.equal(
      db
        .prepare("SELECT status FROM wa_outbox WHERE request_id=?")
        .get(input.requestId).status,
      "read",
    );
    const unknown = {
      ...input,
      requestId: "10000000-0000-4000-8000-000000000002",
      body: "Uncertain reply",
    };
    const failed = await sendOnce(unknown, async () => {
      count++;
      throw new Error("mock disconnected");
    });
    assert.equal(failed.status, "unknown");
    assert.match(failed.error, /mock disconnected/);
    await sendOnce(
      { ...unknown, requestId: "10000000-0000-4000-8000-000000000003" },
      send,
    );
    assert.equal(
      count,
      2,
      "unknown delivery must not be resent with a new request ID",
    );
    await assert.rejects(
      () => sendOnce({ ...input, body: "Changed payload" }, send),
      /冲突/,
    );
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM communications WHERE direction='outbound'",
        )
        .get().n,
      2,
    );
  } finally {
    db.close();
    global.__rehabCrmDb = undefined;
    rmSync(dir, { recursive: true, force: true });
  }
});
