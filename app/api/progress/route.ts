import { assertSameOrigin, requireApiUser } from "../../../lib/auth";
import { customerFor, type Row } from "../../../lib/crm";
import { audit, getDb } from "../../../lib/db";
import { suggestProgress } from "../../../lib/progress";
import { applyProgressSuggestion } from "../../../lib/progress-review";
import { progressMessageSql } from "../../../lib/progress-format";
import { providerFor } from "../../../lib/ai";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const a = await requireApiUser(["admin", "sales"]);
  if (!a.user) return a.response;
  try {
    assertSameOrigin(request);
    const d = await request.json();
    const db = getDb();
    const id = Number(d.customerId);
    customerFor(a.user, id);
    if (d.action === "analyze") {
      if (!providerFor("analysis"))
        throw new Error("尚未配置分析模型，请先到设置中配置并测试");
      const m = db
        .prepare(
          `SELECT id FROM communications WHERE customer_id=? AND project_id=? AND ${progressMessageSql} ORDER BY julianday(occurred_at) DESC,id DESC LIMIT 1`,
        )
        .get(id, Number(d.projectId)) as { id: number } | undefined;
      if (!m) throw new Error("请先录入沟通记录");
      await suggestProgress(m.id);
      return Response.json({ ok: true });
    }
    const row = db
      .prepare(
        "SELECT * FROM progress_suggestions WHERE id=? AND customer_id=? AND status='pending'",
      )
      .get(Number(d.suggestionId), id) as Row | undefined;
    if (!row) throw new Error("建议不存在或已处理");
    if (d.action === "apply") {
      const result = applyProgressSuggestion(Number(row.id), a.user.id);
      if (!result.applied)
        return Response.json({ error: result.reason }, { status: 409 });
    } else if (d.action === "dismiss")
      db.prepare(
        "UPDATE progress_suggestions SET status='dismissed' WHERE id=?",
      ).run(row.id);
    else throw new Error("未知操作");
    audit(a.user.id, "处理进度建议", "customer", String(id), d.action);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
