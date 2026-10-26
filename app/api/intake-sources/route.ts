import { randomBytes } from "node:crypto";
import { assertSameOrigin, requireApiUser } from "../../../lib/auth";
import { audit, getDb } from "../../../lib/db";
import { encryptSecret } from "../../../lib/security";
import { makeIntakeId } from "../../../lib/intake";
export const runtime = "nodejs";
export async function GET() {
  const a = await requireApiUser(["admin"]);
  if (!a.user) return a.response;
  return Response.json({
    sources: getDb()
      .prepare(
        "SELECT id,name,source,campaign,enabled,created_at FROM intake_sources ORDER BY created_at DESC",
      )
      .all(),
  });
}
export async function POST(request: Request) {
  const a = await requireApiUser(["admin"]);
  if (!a.user) return a.response;
  try {
    assertSameOrigin(request);
    const d = await request.json(),
      name = String(d.name || "")
        .trim()
        .slice(0, 100);
    if (!name) throw new Error("请输入入口名称");
    if (!["website", "advertisement", "referral", "other"].includes(d.source))
      throw new Error("请选择来源类型");
    const id = makeIntakeId(),
      secret = randomBytes(32).toString("base64url");
    getDb()
      .prepare(
        "INSERT INTO intake_sources(id,name,source,campaign,owner_id,secret_cipher) VALUES(?,?,?,?,?,?)",
      )
      .run(
        id,
        name,
        d.source,
        String(d.campaign || "").slice(0, 200),
        a.user.id,
        encryptSecret(secret),
      );
    audit(a.user.id, "创建咨询入口", "intake", id);
    return Response.json({ id, secret });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
export async function PATCH(request: Request) {
  const a = await requireApiUser(["admin"]);
  if (!a.user) return a.response;
  try {
    assertSameOrigin(request);
    const d = await request.json();
    getDb()
      .prepare("UPDATE intake_sources SET enabled=? WHERE id=?")
      .run(d.enabled === true ? 1 : 0, String(d.id));
    audit(a.user.id, "启停咨询入口", "intake", String(d.id));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
