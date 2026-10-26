import {
  assertSameOrigin,
  destroySession,
  requireApiUser,
  revokeUserSessions,
} from "../../../../lib/auth";
import { audit, getDb } from "../../../../lib/db";
import {
  hashPassword,
  validatePassword,
  verifyPassword,
} from "../../../../lib/security";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const data = (await request.json()) as {
      currentPassword?: string;
      newPassword?: string;
    };
    const passwordError = validatePassword(data.newPassword || "");
    if (passwordError)
      return Response.json({ error: passwordError }, { status: 400 });
    const db = getDb();
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db
        .prepare(
          "SELECT password_hash FROM users WHERE id=? AND status='active'",
        )
        .get(auth.user.id) as { password_hash: string } | undefined;
      if (
        !row ||
        !verifyPassword(data.currentPassword || "", row.password_hash)
      )
        throw new Error("当前密码不正确");
      db.prepare(
        "UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(hashPassword(data.newPassword!), auth.user.id);
      revokeUserSessions(auth.user.id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    await destroySession();
    audit(auth.user.id, "修改密码", "user", String(auth.user.id));
    return Response.json({
      ok: true,
      reauthRequired: true,
      message: "密码已修改，所有设备已退出，请重新登录",
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "修改失败" },
      { status: 500 },
    );
  }
}
