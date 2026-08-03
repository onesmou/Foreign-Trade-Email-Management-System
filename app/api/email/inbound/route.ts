import { audit, getDb } from "../../../../lib/db";
import { parseRawEmail } from "../../../../lib/email";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const secret = process.env.INBOUND_EMAIL_SECRET;
  if (!secret) return Response.json({ error: "邮件自动转入尚未配置" }, { status: 503 });
  if (request.headers.get("x-inbound-secret") !== secret) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const data = await request.json() as Record<string, string>;
    const raw = data.rawEmail || data.raw || data.text || "";
    const parsed = parseRawEmail(raw);
    const email = (data.fromEmail || parsed.email).trim().toLowerCase();
    if (!email || !raw) return Response.json({ error: "缺少发件人邮箱或邮件全文" }, { status: 400 });
    const db = getDb();
    db.prepare(`INSERT INTO customers (name,email,company,country,phone) VALUES (?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET updated_at=CURRENT_TIMESTAMP`)
      .run(data.fromName || parsed.name, email, data.company || parsed.company, data.country || parsed.country, data.phone || parsed.phone);
    const customer = db.prepare("SELECT id FROM customers WHERE email=?").get(email) as { id: number };
    const info = db.prepare(`INSERT INTO inquiries (customer_id,raw_email,subject,body,source,status,priority,received_at) VALUES (?,?,?,?,?,'待分析','中',?)`)
      .run(customer.id, raw, data.subject || parsed.subject, data.text || parsed.body, "邮件自动转入", data.receivedAt || parsed.receivedAt);
    audit(null, "自动转入邮件", "inquiry", String(info.lastInsertRowid), email);
    return Response.json({ ok: true, id: Number(info.lastInsertRowid) }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "转入失败" }, { status: 500 }); }
}
