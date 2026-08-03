import { env } from "cloudflare:workers";
import { ensureDatabase } from "../../../../db/ensure";

export async function POST(request: Request) {
  const runtime = env as unknown as Record<string, string | undefined>;
  if (!runtime.INBOUND_EMAIL_SECRET) {
    return Response.json({ error: "Inbound email is not configured." }, { status: 503 });
  }
  if (request.headers.get("x-inbound-secret") !== runtime.INBOUND_EMAIL_SECRET) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const data = await request.json() as Record<string, string>;
  if (!data.fromEmail || !data.subject || !data.text) {
    return Response.json({ error: "fromEmail, subject and text are required." }, { status: 400 });
  }
  const db = await ensureDatabase();
  const email = data.fromEmail.trim().toLowerCase();
  await db.prepare(`INSERT INTO customers (name,email,company,country) VALUES (?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET updated_at=CURRENT_TIMESTAMP`)
    .bind(data.fromName || email.split("@")[0], email, data.company || "", data.country || "").run();
  const customer = await db.prepare("SELECT id FROM customers WHERE email=?").bind(email).first<{ id: number }>();
  const result = await db.prepare(`INSERT INTO inquiries (customer_id,subject,body,source,status,priority,received_at)
    VALUES (?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP)) RETURNING id`)
    .bind(customer!.id, data.subject, data.text, "Email webhook", "New", "Medium", data.receivedAt || null).first();
  return Response.json({ ok: true, inquiry: result }, { status: 201 });
}
