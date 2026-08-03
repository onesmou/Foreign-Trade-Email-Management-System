import { assertSameOrigin, createSession, clientIp } from "../../../../lib/auth";
import { audit, getDb, rowCount } from "../../../../lib/db";
import { verifyPassword } from "../../../../lib/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (rowCount("users") === 0) return Response.json({ error: "NEEDS_SETUP" }, { status: 409 });
    const ip = clientIp(request);
    const recent = getDb().prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE action='登录失败' AND ip=? AND created_at>datetime('now','-15 minutes')").get(ip) as { total: number };
    if (Number(recent.total) >= 10) return Response.json({ error: "登录尝试过多，请15分钟后再试" }, { status: 429 });
    const data = await request.json() as { email?: string; password?: string };
    const email = data.email?.trim().toLowerCase() || "";
    const user = getDb().prepare("SELECT * FROM users WHERE email=?").get(email) as Record<string, string | number> | undefined;
    if (!user || user.status !== "active" || !verifyPassword(data.password || "", String(user.password_hash))) {
      audit(user ? Number(user.id) : null, "登录失败", "user", user ? String(user.id) : "", email, ip);
      return Response.json({ error: "邮箱或密码不正确" }, { status: 401 });
    }
    getDb().prepare("UPDATE users SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").run(user.id);
    audit(Number(user.id), "登录成功", "user", String(user.id), "", ip);
    await createSession(Number(user.id), request);
    return Response.json({ ok: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "登录失败" }, { status: 500 }); }
}
