import {
  assertSameOrigin,
  createSession,
  clientIp,
} from "../../../../lib/auth";
import { audit, getDb, rowCount } from "../../../../lib/db";
import {
  hashPassword,
  validatePassword,
  validSetupToken,
} from "../../../../lib/security";

export const runtime = "nodejs";

export async function GET() {
  const needsSetup = rowCount("users") === 0;
  return Response.json({
    needsSetup,
    requiresSetupToken: needsSetup && Boolean(process.env.SETUP_TOKEN),
  });
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (rowCount("users") > 0)
      return Response.json({ error: "系统已经初始化" }, { status: 409 });
    const data = (await request.json()) as {
      name?: string;
      email?: string;
      password?: string;
      companyName?: string;
      setupToken?: string;
    };
    if (!validSetupToken(String(data.setupToken || "")))
      return Response.json(
        { error: "初始化验证码不正确，请向部署管理员获取" },
        { status: 403 },
      );
    const name = data.name?.trim() || "";
    const email = data.email?.trim().toLowerCase() || "";
    const password = data.password || "";
    if (!name || !/^\S+@\S+\.\S+$/.test(email))
      return Response.json({ error: "请填写姓名和有效邮箱" }, { status: 400 });
    const passwordError = validatePassword(password);
    if (passwordError)
      return Response.json({ error: passwordError }, { status: 400 });
    const db = getDb();
    let userId: number;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (rowCount("users") > 0) {
        db.exec("ROLLBACK");
        return Response.json({ error: "系统已经初始化" }, { status: 409 });
      }
      const info = db
        .prepare(
          "INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,'admin')",
        )
        .run(name, email, hashPassword(password));
      if (data.companyName?.trim())
        db.prepare(
          "UPDATE company_profile SET company_name=?,updated_at=CURRENT_TIMESTAMP WHERE id=1",
        ).run(data.companyName.trim());
      userId = Number(info.lastInsertRowid);
      audit(
        userId,
        "初始化系统",
        "user",
        String(userId),
        "创建首位管理员",
        clientIp(request),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    await createSession(userId, request);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "初始化失败" },
      { status: 500 },
    );
  }
}
