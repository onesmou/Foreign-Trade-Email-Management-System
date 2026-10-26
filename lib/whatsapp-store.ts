import "server-only";
import { createHash } from "node:crypto";
import { getDb } from "./db";
import { addCommunication, addProject, type Row } from "./crm";
import { canonicalJid } from "./whatsapp-identity";
export const privateJid = (jid: string) =>
  /^[a-zA-Z0-9_.:-]+@(s\.whatsapp\.net|lid)$/.test(jid);
export function saveInboxMessage(input: {
  jid: string;
  key: string;
  fromMe: boolean;
  body: string;
  timestamp: number;
  rawKey: object;
  kind?: string;
  status?: string;
  analyze?: boolean;
  payloadCipher?: string;
  mediaName?: string;
  mediaMime?: string;
  mediaSize?: number;
}) {
  if (!privateJid(input.jid) || !input.key || !input.body) return;
  input = { ...input, jid: canonicalJid(input.jid) };
  const db = getDb();
  db.prepare(
    `INSERT INTO wa_messages(jid,message_key,from_me,body,timestamp,raw_key,kind,status) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(jid,message_key) DO NOTHING`,
  ).run(
    input.jid,
    input.key,
    input.fromMe ? 1 : 0,
    input.body.slice(0, 100000),
    input.timestamp,
    JSON.stringify(input.rawKey),
    input.kind || "text",
    input.status || (input.fromMe ? "synced" : "received"),
  );
  if (input.payloadCipher)
    db.prepare(
      "UPDATE wa_messages SET payload_cipher=?,media_name=?,media_mime=?,media_size=? WHERE jid=? AND message_key=?",
    ).run(
      input.payloadCipher,
      input.mediaName || "",
      input.mediaMime || "",
      input.mediaSize || 0,
      input.jid,
      input.key,
    );
  archiveInbox(input.jid, input.analyze ? input.key : undefined);
}
export function archiveInbox(jid: string, analyzeKey?: string) {
  jid = canonicalJid(jid);
  const db = getDb(),
    contact = db
      .prepare(
        "SELECT * FROM wa_contacts WHERE jid=? AND selected=1 AND customer_id IS NOT NULL",
      )
      .get(jid) as Row | undefined;
  if (!contact) return;
  const messages = db
    .prepare(
      "SELECT m.* FROM wa_messages m WHERE jid=? AND NOT EXISTS(SELECT 1 FROM communications c WHERE c.external_id='wa:' || ? || ':' || m.message_key) ORDER BY timestamp,id",
    )
    .all(jid, contact.customer_id) as Row[];
  if (!messages.length) return;
  const projects = db
    .prepare(
      "SELECT id FROM projects WHERE customer_id=? AND stage NOT IN ('成交','暂停','流失')",
    )
    .all(contact.customer_id) as Row[];
  let projectId = projects.length === 1 ? Number(projects[0].id) : undefined;
  if (!projects.length)
    projectId = addProject(Number(contact.customer_id), "WhatsApp采购需求");
  for (const m of messages) {
    const externalId = `wa:${contact.customer_id}:${m.message_key}`;
    if (
      db
        .prepare("SELECT id FROM communications WHERE external_id=?")
        .get(externalId)
    )
      continue;
    const id = addCommunication({
      customerId: Number(contact.customer_id),
      projectId,
      channel: "whatsapp",
      direction: m.from_me ? "outbound" : "inbound",
      body: String(m.body),
      externalId,
      status: String(m.status),
      occurredAt: new Date(Number(m.timestamp) * 1000).toISOString(),
      analyze: m.message_key === analyzeKey,
    });
    if (m.translation)
      db.prepare("UPDATE communications SET translation=? WHERE id=?").run(
        m.translation,
        id,
      );
  }
}
export function updateDelivery(jid: string, key: string, status: string) {
  jid = canonicalJid(jid);
  const db = getDb();
  // Never downgrade read/delivered based on an older network event.
  const rank: Record<string, number> = {
    sending: 0,
    unknown: 0,
    accepted: 1,
    synced: 1,
    delivered: 2,
    read: 3,
  };
  const row = db
    .prepare("SELECT status FROM wa_messages WHERE jid=? AND message_key=?")
    .get(jid, key) as Row | undefined;
  if (row && (rank[String(row.status)] || 0) > (rank[status] || 0)) return;
  db.prepare(
    "UPDATE wa_messages SET status=? WHERE jid=? AND message_key=? AND from_me=1",
  ).run(status, jid, key);
  db.prepare(
    "UPDATE wa_outbox SET status=?,error=CASE WHEN ?='unknown' THEN error ELSE '' END WHERE jid=? AND message_key=?",
  ).run(status, status, jid, key);
  const contact = db
    .prepare("SELECT customer_id FROM wa_contacts WHERE jid=?")
    .get(jid) as Row | undefined;
  if (contact?.customer_id)
    db.prepare(
      "UPDATE communications SET send_status=? WHERE external_id=? AND direction='outbound'",
    ).run(status, `wa:${contact.customer_id}:${key}`);
}

// Transport injected for tests, never an HTTP test-send backdoor.
export async function sendOnce(
  input: { requestId: string; jid: string; body: string; userId: number },
  send: (
    jid: string,
    text: string,
    messageId: string,
  ) => Promise<{ key?: { id?: string | null } } | undefined>,
) {
  const db = getDb(),
    { requestId, jid, body, userId } = input;
  if (
    !/^[a-zA-Z0-9-]{16,80}$/.test(requestId) ||
    !privateJid(jid) ||
    !body.trim() ||
    body.length > 10000
  )
    throw new Error("收件人、内容或请求标识无效");
  const previous = db
    .prepare("SELECT * FROM wa_outbox WHERE request_id=?")
    .get(requestId) as Row | undefined;
  if (previous) {
    if (
      previous.jid !== jid ||
      previous.body !== body ||
      Number(previous.created_by) !== userId
    )
      throw new Error("请求标识冲突");
    return previous;
  }
  const uncertain = db
    .prepare(
      "SELECT * FROM wa_outbox WHERE jid=? AND body=? AND status IN ('sending','unknown') ORDER BY created_at DESC LIMIT 1",
    )
    .get(jid, body) as Row | undefined;
  if (uncertain) return uncertain;
  const messageId = `3EB0${createHash("sha256").update(`${jid}:${requestId}`).digest("hex").slice(0, 28).toUpperCase()}`;
  db.prepare(
    "INSERT INTO wa_outbox(request_id,jid,body,status,message_key,created_by) VALUES(?,?,?,'sending',?,?)",
  ).run(requestId, jid, body, messageId, userId);
  saveInboxMessage({
    jid,
    key: messageId,
    body,
    fromMe: true,
    timestamp: Math.floor(Date.now() / 1000),
    rawKey: { remoteJid: jid, id: messageId, fromMe: true },
    status: "sending",
  });
  try {
    const result = await Promise.race([
      send(jid, body, messageId),
      new Promise<never>((_, reject) => {
        const t = setTimeout(
          () => reject(new Error("发送等待超时，结果待确认，请勿重复发送")),
          22000,
        );
        t.unref();
      }),
    ]);
    if (!result?.key?.id)
      throw new Error("平台未返回发送回执，结果待确认，请先检查手机");
    db.prepare(
      "UPDATE wa_outbox SET status=CASE WHEN status IN ('delivered','read') THEN status ELSE 'accepted' END WHERE request_id=?",
    ).run(requestId);
    updateDelivery(jid, messageId, "accepted");
  } catch (e) {
    db.prepare(
      "UPDATE wa_outbox SET status=CASE WHEN status IN ('accepted','delivered','read') THEN status ELSE 'unknown' END,error=? WHERE request_id=?",
    ).run((e as Error).message.slice(0, 500), requestId);
    updateDelivery(jid, messageId, "unknown");
  }
  return db
    .prepare("SELECT * FROM wa_outbox WHERE request_id=?")
    .get(requestId) as Row;
}
