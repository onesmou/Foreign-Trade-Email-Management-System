import { ensureDatabase } from "../../../db/ensure";

export const dynamic = "force-dynamic";

const selectSql = `SELECT i.*, c.name, c.email, c.company, c.country, c.customer_type, c.stage
  FROM inquiries i JOIN customers c ON c.id = i.customer_id`;

export async function GET() {
  try {
    const db = await ensureDatabase();
    const rows = await db.prepare(`${selectSql} ORDER BY datetime(i.received_at) DESC, i.id DESC`).all();
    return Response.json({ inquiries: rows.results });
  } catch (error) {
    return Response.json({ error: messageOf(error) }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.json() as Record<string, string>;
    const email = data.email?.trim().toLowerCase();
    const subject = data.subject?.trim();
    const body = data.body?.trim();
    if (!email || !subject || !body) {
      return Response.json({ error: "Email, subject and message are required." }, { status: 400 });
    }
    const db = await ensureDatabase();
    await db.prepare(`INSERT INTO customers (name,email,company,country,customer_type,stage)
      VALUES (?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET
      name=excluded.name, company=excluded.company, country=excluded.country, updated_at=CURRENT_TIMESTAMP`)
      .bind(data.name?.trim() || email.split("@")[0], email, data.company?.trim() || "", data.country?.trim() || "", "Unknown", "New lead").run();
    const customer = await db.prepare("SELECT id FROM customers WHERE email=?").bind(email).first<{ id: number }>();
    const result = await db.prepare(`INSERT INTO inquiries (customer_id,subject,body,source,status,priority)
      VALUES (?,?,?,?,?,?) RETURNING id`).bind(customer!.id, subject, body, data.source || "Manual import", "New", "Medium").first<{ id: number }>();
    const row = await db.prepare(`${selectSql} WHERE i.id=?`).bind(result!.id).first();
    return Response.json({ inquiry: row }, { status: 201 });
  } catch (error) {
    return Response.json({ error: messageOf(error) }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const data = await request.json() as Record<string, string | number>;
    const id = Number(data.id);
    if (!id) return Response.json({ error: "Inquiry id is required." }, { status: 400 });
    const db = await ensureDatabase();
    if (data.status) {
      await db.prepare("UPDATE inquiries SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(String(data.status), id).run();
    }
    const row = await db.prepare(`${selectSql} WHERE i.id=?`).bind(id).first();
    return Response.json({ inquiry: row });
  } catch (error) {
    return Response.json({ error: messageOf(error) }, { status: 500 });
  }
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}
