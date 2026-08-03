import { assertSameOrigin, requireApiUser } from "../../../lib/auth";
import { audit, getDb } from "../../../lib/db";
import { parseRawEmail } from "../../../lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const selectSql = `SELECT i.*,c.name,c.email,c.company,c.country,c.phone,c.customer_type,c.stage,
  u.name AS owner_name,p.name AS provider_name FROM inquiries i
  JOIN customers c ON c.id=i.customer_id
  LEFT JOIN users u ON u.id=c.owner_id
  LEFT JOIN ai_providers p ON p.id=i.provider_id`;

export async function GET() {
  const auth = await requireApiUser(); if (!auth.user) return auth.response;
  const rows = getDb().prepare(`${selectSql} ORDER BY datetime(i.received_at) DESC,i.id DESC`).all();
  return Response.json({ inquiries: rows });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(["admin", "sales"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const data = await request.json() as Record<string, string>;
    const parsed = parseRawEmail(data.rawEmail || data.raw_email || data.body || "");
    const email = (data.email || parsed.email).trim().toLowerCase();
    const subject = (data.subject || parsed.subject).trim();
    const body = (data.body || parsed.body).trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "没有识别到有效客户邮箱，请在邮件全文中保留发件人信息" }, { status: 400 });
    if (!body) return Response.json({ error: "没有识别到邮件正文" }, { status: 400 });
    const db = getDb();
    db.prepare(`INSERT INTO customers (name,email,company,country,phone,owner_id) VALUES (?,?,?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''),name),company=COALESCE(NULLIF(excluded.company,''),company),country=COALESCE(NULLIF(excluded.country,''),country),phone=COALESCE(NULLIF(excluded.phone,''),phone),updated_at=CURRENT_TIMESTAMP`)
      .run(data.name || parsed.name, email, data.company || parsed.company, data.country || parsed.country, data.phone || parsed.phone, auth.user.id);
    const customer = db.prepare("SELECT id FROM customers WHERE email=?").get(email) as { id: number };
    const info = db.prepare(`INSERT INTO inquiries (customer_id,raw_email,subject,body,source,status,priority,received_at,created_by,updated_by)
      VALUES (?,?,?,?,?,'待分析','中',?,?,?)`).run(customer.id, data.rawEmail || data.raw_email || "", subject, body, data.source || "整封邮件录入", data.receivedAt || parsed.receivedAt, auth.user.id, auth.user.id);
    const row = db.prepare(`${selectSql} WHERE i.id=?`).get(info.lastInsertRowid);
    audit(auth.user.id, "录入询盘", "inquiry", String(info.lastInsertRowid), `${email} / ${subject}`);
    return Response.json({ inquiry: row }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser(["admin", "sales"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const data = await request.json() as { id?: number; status?: string };
    const id = Number(data.id); if (!id) return Response.json({ error: "询盘ID无效" }, { status: 400 });
    const allowed = ["待分析", "待回复", "草稿完成", "已回复", "已归档"];
    if (data.status && allowed.includes(data.status)) getDb().prepare("UPDATE inquiries SET status=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(data.status, auth.user.id, id);
    const row = getDb().prepare(`${selectSql} WHERE i.id=?`).get(id);
    audit(auth.user.id, "更新询盘状态", "inquiry", String(id), data.status || "");
    return Response.json({ inquiry: row });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "更新失败" }, { status: 500 }); }
}
