import {
  assertSameOrigin,
  destroySession,
  requireApiUser,
  revokeUserSessions,
} from "../../../lib/auth";
import { audit, getDb } from "../../../lib/db";
import { hashPassword, validatePassword } from "../../../lib/security";

export async function GET() {
  const auth = await requireApiUser(["admin"]);
  if (!auth.user) return auth.response;
  const users = getDb()
    .prepare(
      "SELECT id,name,email,role,status,created_at,last_login_at FROM users ORDER BY id",
    )
    .all();
  return Response.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(["admin"]);
  if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const data = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
      role?: string;
    };
    const name = data.name?.trim() || "";
    const email = data.email?.trim().toLowerCase() || "";
    const password = data.password || "";
    const role = ["admin", "sales", "viewer"].includes(data.role || "")
      ? data.role!
      : "sales";
    const passwordError = validatePassword(password);
    if (passwordError)
      return Response.json({ error: passwordError }, { status: 400 });
    if (!name || !/^\S+@\S+\.\S+$/.test(email))
      return Response.json({ error: "请填写姓名和有效邮箱" }, { status: 400 });
    const info = getDb()
      .prepare(
        "INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)",
      )
      .run(name, email, hashPassword(password), role);
    audit(
      auth.user.id,
      "创建用户",
      "user",
      String(info.lastInsertRowid),
      `${email} / ${role}`,
    );
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error && /UNIQUE/.test(error.message)
        ? "该邮箱已存在"
        : error instanceof Error
          ? error.message
          : "创建失败";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser(["admin"]);
  if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const data = (await request.json()) as {
      id?: number;
      role?: string;
      status?: string;
      resetPassword?: string;
    };
    const id = Number(data.id);
    if (!id) return Response.json({ error: "用户ID无效" }, { status: 400 });
    if (id === auth.user.id && data.status === "disabled")
      return Response.json({ error: "不能停用当前登录账号" }, { status: 400 });
    if (data.resetPassword) {
      const error = validatePassword(data.resetPassword);
      if (error) return Response.json({ error }, { status: 400 });
    }
    const db = getDb();
    let sessionsRevoked = 0;
    let changed = false;
    db.exec("BEGIN IMMEDIATE");
    try {
      const target = db
        .prepare("SELECT role,status FROM users WHERE id=?")
        .get(id) as { role: string; status: string } | undefined;
      if (!target) throw new Error("用户不存在");
      const nextRole =
        data.role && ["admin", "sales", "viewer"].includes(data.role)
          ? data.role
          : target.role;
      const nextStatus =
        data.status && ["active", "disabled"].includes(data.status)
          ? data.status
          : target.status;
      if (
        target.role === "admin" &&
        target.status === "active" &&
        (nextRole !== "admin" || nextStatus !== "active")
      ) {
        const admins = getDb()
          .prepare(
            "SELECT COUNT(*) AS total FROM users WHERE role='admin' AND status='active'",
          )
          .get() as { total: number };
        if (Number(admins.total) <= 1)
          throw new Error("系统至少需要一个启用的管理员");
      }
      if (data.role && ["admin", "sales", "viewer"].includes(data.role))
        getDb()
          .prepare(
            "UPDATE users SET role=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .run(data.role, id);
      if (data.status && ["active", "disabled"].includes(data.status))
        getDb()
          .prepare(
            "UPDATE users SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .run(data.status, id);
      if (data.resetPassword) {
        getDb()
          .prepare(
            "UPDATE users SET password_hash=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
          )
          .run(hashPassword(data.resetPassword), id);
      }
      changed =
        Boolean(data.resetPassword) ||
        nextRole !== target.role ||
        nextStatus !== target.status;
      if (changed) sessionsRevoked = revokeUserSessions(id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const reauthRequired = id === auth.user.id && changed;
    if (reauthRequired) await destroySession();
    audit(
      auth.user.id,
      "更新用户",
      "user",
      String(id),
      JSON.stringify({
        role: data.role,
        status: data.status,
        reset: Boolean(data.resetPassword),
      }),
    );
    return Response.json({
      ok: true,
      reauthRequired,
      sessionsRevoked,
      message: changed ? "用户已更新，旧设备登录已失效" : "用户已更新",
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "更新失败" },
      { status: 500 },
    );
  }
}
