import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "./db";
import type { SessionUser } from "./auth";

export type Row = Record<string, string | number | null>;
export const stages = [
  "需求确认",
  "方案准备",
  "已报价",
  "商务沟通",
  "成交",
  "暂停",
  "流失",
];
export function accessSql(user: SessionUser, alias = "c") {
  return user.role === "admin"
    ? "1=1"
    : `(${alias}.owner_id=${Number(user.id)} OR EXISTS(SELECT 1 FROM customer_access ca WHERE ca.customer_id=${alias}.id AND ca.user_id=${Number(user.id)}))`;
}
export function customerFor(user: SessionUser, id: number) {
  const c = getDb()
    .prepare(`SELECT c.* FROM customers c WHERE c.id=? AND ${accessSql(user)}`)
    .get(id) as Row | undefined;
  if (!c) throw new Error("客户不存在或未获授权");
  if (String(c.email).endsWith("@identity.invalid")) c.email = "";
  return c;
}
export function normalizePhone(value: string) {
  return value.replace(/[^\d]/g, "").replace(/^00/, "");
}
export function customerList(user: SessionUser) {
  return (
    getDb()
      .prepare(
        `SELECT c.*, (SELECT avatar FROM wa_contacts w WHERE w.customer_id=c.id AND w.selected=1 AND w.avatar!='' LIMIT 1) AS avatar, (SELECT COUNT(*) FROM communications m WHERE m.customer_id=c.id) AS message_count,
    (SELECT body FROM communications m WHERE m.customer_id=c.id ORDER BY m.id DESC LIMIT 1) AS latest_message,
    (SELECT next_action FROM projects p WHERE p.customer_id=c.id ORDER BY p.updated_at DESC,p.id DESC LIMIT 1) AS next_action,
    (SELECT follow_up FROM projects p WHERE p.customer_id=c.id ORDER BY p.updated_at DESC,p.id DESC LIMIT 1) AS follow_up
    FROM customers c WHERE ${accessSql(user)} ORDER BY c.updated_at DESC,c.id DESC`,
      )
      .all() as Row[]
  ).map((c) => ({
    ...c,
    email: String(c.email).endsWith("@identity.invalid") ? "" : c.email,
  }));
}
export function customerDetail(user: SessionUser, id: number) {
  const customer = customerFor(user, id);
  const db = getDb();
  return {
    customer,
    projects: db
      .prepare("SELECT * FROM projects WHERE customer_id=? ORDER BY id DESC")
      .all(id),
    messages: db
      .prepare(
        `SELECT c.*,w.id AS wa_message_id,w.media_name,w.media_size,(w.payload_cipher!='' OR w.media_stored_name!='') AS media_available FROM communications c LEFT JOIN wa_messages w ON c.external_id='wa:' || c.customer_id || ':' || w.message_key AND w.jid IN (SELECT jid FROM wa_contacts WHERE customer_id=c.customer_id AND selected=1) WHERE c.customer_id=? ORDER BY c.occurred_at DESC,c.id DESC LIMIT 300`,
      )
      .all(id),
    chat: db
      .prepare(
        "SELECT * FROM assistant_messages WHERE customer_id=? ORDER BY id DESC LIMIT 100",
      )
      .all(id)
      .reverse(),
    memories: db
      .prepare(
        "SELECT * FROM customer_memories WHERE customer_id=? ORDER BY id DESC",
      )
      .all(id),
    suggestions: db
      .prepare(
        "SELECT * FROM progress_suggestions WHERE customer_id=? AND status='pending' ORDER BY id DESC LIMIT 10",
      )
      .all(id),
    attachments: db
      .prepare(
        "SELECT id,original_name,category,scope,status,summary,version,is_current,can_send FROM knowledge_files WHERE customer_id=? AND is_current=1",
      )
      .all(id),
  };
}
export function findOrCreateCustomer(
  user: SessionUser,
  input: {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    country?: string;
    source?: string;
    campaign?: string;
  },
) {
  const db = getDb();
  const email = (input.email || "").trim().toLowerCase();
  const phone = normalizePhone(input.phone || "");
  if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new Error("邮箱格式无效");
  if (phone && (phone.length < 7 || phone.length > 15))
    throw new Error("请输入含国家区号的有效电话");
  // Never merge by similar company/name. Exact email/normalized phone only.
  const all = db.prepare("SELECT id,email,phone FROM customers").all() as Row[];
  const matches = all.filter(
    (c) =>
      (email && String(c.email).toLowerCase() === email) ||
      (phone && normalizePhone(String(c.phone)) === phone),
  );
  if (new Set(matches.map((c) => c.id)).size > 1)
    throw new Error("邮箱和电话对应不同客户，请先人工核对，未自动合并");
  if (matches.length) {
    const id = Number(matches[0].id);
    customerFor(user, id);
    db.prepare(
      "UPDATE customers SET updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(id);
    return { id, existing: true };
  }
  // Legacy email is NOT NULL UNIQUE: reserved internal identity, never presented as a customer email.
  const key = email || `${randomUUID()}@identity.invalid`;
  const inserted = db
    .prepare(
      "INSERT INTO customers(name,email,phone,company,country,owner_id,first_source,campaign) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      input.name || "待补充联系人",
      key,
      phone ? `+${phone}` : "",
      input.company || "",
      input.country || "",
      user.id,
      input.source || "其他",
      input.campaign || "",
    );
  const id = Number(inserted.lastInsertRowid);
  return { id, existing: false };
}
export function addProject(customerId: number, title: string) {
  return Number(
    getDb()
      .prepare("INSERT INTO projects(customer_id,title) VALUES(?,?)")
      .run(customerId, title.slice(0, 160) || "采购需求").lastInsertRowid,
  );
}
export function validProject(customerId: number, id: number) {
  return getDb()
    .prepare("SELECT * FROM projects WHERE customer_id=? AND id=?")
    .get(customerId, id) as Row | undefined;
}
export function addCommunication(input: {
  customerId: number;
  projectId?: number;
  channel: string;
  direction?: string;
  subject?: string;
  body: string;
  userId?: number;
  externalId?: string;
  status?: string;
  occurredAt?: string;
  analyze?: boolean;
}) {
  const db = getDb();
  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO communications(customer_id,project_id,channel,direction,subject,body,created_by,external_id,send_status,occurred_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.customerId,
      input.projectId || null,
      input.channel,
      input.direction || "inbound",
      input.subject || "",
      input.body.slice(0, 100000),
      input.userId || null,
      input.externalId || null,
      input.status || "received",
      input.occurredAt || new Date().toISOString(),
    );
  const id = Number(inserted.lastInsertRowid);
  if (!inserted.changes) {
    const existing = db
      .prepare(
        "SELECT id FROM communications WHERE external_id=? AND customer_id=?",
      )
      .get(input.externalId || null, input.customerId) as
      { id: number } | undefined;
    if (!existing) throw new Error("消息标识冲突，未更新已有记录");
    return existing.id;
  }
  db.prepare(
    "UPDATE customers SET updated_at=CURRENT_TIMESTAMP WHERE id=?",
  ).run(input.customerId);
  if (
    input.analyze !== false &&
    (input.direction !== "outbound" ||
      [
        "accepted",
        "delivered",
        "read",
        "synced",
        "manual_sent",
        "confirmed_sent",
      ].includes(input.status || "")) &&
    input.channel !== "note" &&
    input.projectId
  ) {
    db.prepare(
      "UPDATE communications SET progress_state='queued' WHERE id=?",
    ).run(id);
    setTimeout(
      () =>
        void import("./progress")
          .then((m) => m.suggestProgress(id))
          .catch(() => {}),
      20,
    );
  }
  return id;
}
export function fileAccess(user: SessionUser, file: Row) {
  if (file.scope === "internal") return user.role === "admin";
  if (
    Number(file.auto_organize) &&
    !Number(file.manual_folder) &&
    file.organize_status !== "已归类" &&
    user.role !== "admin" &&
    Number(file.uploaded_by) !== user.id
  )
    return false;
  if (file.scope === "customer") {
    try {
      customerFor(user, Number(file.customer_id));
      return true;
    } catch {
      return false;
    }
  }
  return file.scope === "company";
}
