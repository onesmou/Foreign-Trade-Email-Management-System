import { assertSameOrigin, requireApiUser } from "../../../../lib/auth";
import { audit, getDb } from "../../../../lib/db";
import { hashPassword, validatePassword, verifyPassword } from "../../../../lib/security";

export async function POST(request: Request) {
  const auth = await requireApiUser(); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const data = await request.json() as { currentPassword?: string; newPassword?: string };
    const passwordError = validatePassword(data.newPassword || ""); if (passwordError) return Response.json({ error: passwordError }, { status: 400 });
    const row = getDb().prepare("SELECT password_hash FROM users WHERE id=?").get(auth.user.id) as { password_hash: string };
    if (!verifyPassword(data.currentPassword || "", row.password_hash)) return Response.json({ error: "当前密码不正确" }, { status: 400 });
    getDb().prepare("UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(hashPassword(data.newPassword!), auth.user.id);
    audit(auth.user.id, "修改密码", "user", String(auth.user.id));
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "修改失败" }, { status: 500 }); }
}
