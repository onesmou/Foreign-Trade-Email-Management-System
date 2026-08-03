import { assertSameOrigin, createSession, clientIp } from "../../../../lib/auth";
import { audit, getDb, rowCount } from "../../../../lib/db";
import { hashPassword, validatePassword } from "../../../../lib/security";

export const runtime = "nodejs";

export async function GET() { return Response.json({ needsSetup: rowCount("users") === 0 }); }

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (rowCount("users") > 0) return Response.json({ error: "系统已经初始化" }, { status: 409 });
    const data = await request.json() as { name?: string; email?: string; password?: string; companyName?: string };
    const name = data.name?.trim() || ""; const email = data.email?.trim().toLowerCase() || ""; const password = data.password || "";
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) return Response.json({ error: "请填写姓名和有效邮箱" }, { status: 400 });
    const passwordError = validatePassword(password); if (passwordError) return Response.json({ error: passwordError }, { status: 400 });
    const db = getDb();
    const info = db.prepare("INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')").run(name, email, hashPassword(password));
    if (data.companyName?.trim()) db.prepare("UPDATE company_profile SET company_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=1").run(data.companyName.trim());
    const userId = Number(info.lastInsertRowid);
    audit(userId, "初始化系统", "user", String(userId), "创建首位管理员", clientIp(request));
    await createSession(userId, request);
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "初始化失败" }, { status: 500 }); }
}
