import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "./db";

export type SessionUser = { id: number; name: string; email: string; role: "admin" | "sales" | "viewer" };
export const SESSION_COOKIE = "rehabintl_crm_session";

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = getDb().prepare(`SELECT u.id,u.name,u.email,u.role FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>datetime('now') AND u.status='active'`).get(token) as SessionUser | undefined;
  return row || null;
}

export async function createSession(userId: number, request: Request) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 7 * 86400_000);
  getDb().prepare("INSERT INTO sessions (id,user_id,expires_at,user_agent,ip) VALUES (?,?,?,?,?)")
    .run(token, userId, expires.toISOString(), request.headers.get("user-agent") || "", clientIp(request));
  (await cookies()).set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", expires });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) getDb().prepare("DELETE FROM sessions WHERE id=?").run(token);
  store.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

export async function requireApiUser(roles?: SessionUser["role"][]) {
  const user = await getCurrentUser();
  if (!user) return { user: null, response: Response.json({ error: "请先登录" }, { status: 401 }) };
  if (roles && !roles.includes(user.role)) return { user: null, response: Response.json({ error: "没有操作权限" }, { status: 403 }) };
  return { user, response: null };
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestedHost = (request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host).split(",")[0].trim();
  const configuredHost = process.env.APP_URL ? new URL(process.env.APP_URL).host : "";
  const originHost = new URL(origin).host;
  if (originHost !== requestedHost && originHost !== configuredHost) throw new Error("请求来源验证失败");
}

export function clientIp(request: Request) {
  return (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "").split(",")[0].trim();
}
