import { assertSameOrigin, requireApiUser } from "../../../lib/auth";
import { customerFor, type Row } from "../../../lib/crm";
import { audit, getDb } from "../../../lib/db";
import { progressSchema, suggestProgress } from "../../../lib/progress";
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
      const m = db
        .prepare(
          "SELECT id FROM communications WHERE customer_id=? AND project_id=? ORDER BY id DESC LIMIT 1",
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
      const p = progressSchema.parse(JSON.parse(String(row.payload)));
      if (p.conflicts.length)
        throw new Error(
          "包含冲突信息，请在项目和客户记忆中人工纠正，不自动覆盖",
        );
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare(
          "UPDATE projects SET product=COALESCE(NULLIF(?,''),product),quantity=COALESCE(NULLIF(?,''),quantity),destination=COALESCE(NULLIF(?,''),destination),waiting_on=?,next_action=?,follow_up='',evidence_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND customer_id=?",
        ).run(
          p.product,
          p.quantity,
          p.destination,
          p.waiting_on,
          p.next_action,
          row.evidence_id,
          row.project_id,
          id,
        );
        db.prepare(
          "INSERT INTO customer_memories(customer_id,project_id,content,kind,evidence_id,created_by) VALUES(?,?,?,'user',?,?)",
        ).run(
          id,
          row.project_id,
          `已复核消息 #${row.evidence_id}：${p.summary}`,
          row.evidence_id,
          a.user.id,
        );
        db.prepare(
          "UPDATE progress_suggestions SET status='applied' WHERE id=?",
        ).run(row.id);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
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
