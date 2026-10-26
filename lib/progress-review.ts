import "server-only";
import { getDb } from "./db";
import type { Row } from "./crm";
import { progressMessageSql, progressSchema } from "./progress-format";
export function latestProgressMessage(projectId: number) {
  return getDb()
    .prepare(
      `SELECT id FROM communications WHERE project_id=? AND ${progressMessageSql} ORDER BY julianday(occurred_at) DESC,id DESC LIMIT 1`,
    )
    .get(projectId) as { id: number } | undefined;
}
export function applyProgressSuggestion(
  id: number,
  userId: number | null,
  automatic = false,
) {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db
      .prepare(
        "SELECT * FROM progress_suggestions WHERE id=? AND status='pending'",
      )
      .get(id) as Row | undefined;
    if (!row) throw new Error("建议不存在或已处理");
    const project = db
      .prepare("SELECT * FROM projects WHERE id=? AND customer_id=?")
      .get(row.project_id, row.customer_id) as Row | undefined;
    if (!project) throw new Error("项目不存在");
    if (
      Number(row.project_revision) !== Number(project.progress_revision) ||
      Number(row.basis_message_id) !==
        latestProgressMessage(Number(project.id))?.id
    ) {
      db.prepare(
        "UPDATE progress_suggestions SET status='superseded' WHERE id=?",
      ).run(id);
      db.exec("COMMIT");
      return { applied: false, reason: "有更新的沟通或人工修改，请重新分析" };
    }
    const p = progressSchema.parse(JSON.parse(String(row.payload)));
    if (p.conflicts.length) throw new Error("包含冲突信息，请先人工核对");
    // Automatic mode is opt-in and may only advance workflow, never change facts.
    if (
      automatic &&
      (!project.auto_progress ||
        (["product", "quantity", "destination"] as const).some(
          (k) => p[k].trim() && p[k].trim() !== String(project[k] || "").trim(),
        ))
    ) {
      db.exec("COMMIT");
      return { applied: false, reason: "新的产品、数量或目的地需要人工确认" };
    }
    let followUp = String(project.follow_up || "");
    if (p.waiting_on !== "客户") followUp = "";
    else if (!followUp || project.waiting_on !== "客户") {
      const days = Number(project.follow_up_days);
      followUp =
        days > 0
          ? new Intl.DateTimeFormat("en-CA", {
              timeZone: "Asia/Shanghai",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date(Date.now() + days * 86400000))
          : "";
    }
    db.prepare(
      "UPDATE projects SET product=COALESCE(NULLIF(?,''),product),quantity=COALESCE(NULLIF(?,''),quantity),destination=COALESCE(NULLIF(?,''),destination),waiting_on=?,next_action=?,follow_up=?,evidence_id=?,progress_revision=progress_revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(
      p.product,
      p.quantity,
      p.destination,
      p.waiting_on,
      p.next_action,
      followUp,
      row.evidence_id,
      project.id,
    );
    db.prepare(
      "INSERT INTO customer_memories(customer_id,project_id,content,kind,evidence_id,created_by) VALUES(?,?,?,?,?,?)",
    ).run(
      row.customer_id,
      row.project_id,
      `${automatic ? "自动跟进建议，事实以原文为准" : "已复核"}消息 #${row.evidence_id}：${p.summary}`,
      automatic ? "ai" : "user",
      row.evidence_id,
      userId,
    );
    db.prepare("UPDATE progress_suggestions SET status=? WHERE id=?").run(
      automatic ? "auto_applied" : "applied",
      id,
    );
    db.prepare(
      "UPDATE progress_suggestions SET status='superseded' WHERE project_id=? AND status='pending' AND id!=?",
    ).run(project.id, id);
    db.exec("COMMIT");
    return { applied: true, followUp };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
