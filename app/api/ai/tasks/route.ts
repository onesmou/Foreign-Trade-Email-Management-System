import { assertSameOrigin, requireApiUser } from "../../../../lib/auth";
import { audit, getDb } from "../../../../lib/db";
export const runtime = "nodejs";
export async function GET() {
  const a = await requireApiUser(["admin"]);
  if (!a.user) return a.response;
  return Response.json({
    routes: getDb().prepare("SELECT * FROM ai_task_routes").all(),
  });
}
export async function PATCH(request: Request) {
  const a = await requireApiUser(["admin"]);
  if (!a.user) return a.response;
  try {
    assertSameOrigin(request);
    const d = await request.json();
    if (!["chat", "analysis", "translation", "vision"].includes(d.task))
      throw new Error("任务无效");
    const db = getDb();
    if (!d.providerId)
      db.prepare("DELETE FROM ai_task_routes WHERE task=?").run(d.task);
    else {
      if (
        !db
          .prepare("SELECT id FROM ai_providers WHERE id=? AND enabled=1")
          .get(Number(d.providerId))
      )
        throw new Error("配置不存在或已停用");
      db.prepare(
        "INSERT INTO ai_task_routes(task,provider_id) VALUES(?,?) ON CONFLICT(task) DO UPDATE SET provider_id=excluded.provider_id",
      ).run(d.task, Number(d.providerId));
    }
    audit(a.user.id, "调整AI任务分工", "ai_task", d.task);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
