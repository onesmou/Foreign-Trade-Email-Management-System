import { requireApiUser } from "../../../lib/auth";
import { customerFor, type Row } from "../../../lib/crm";
import { getDb } from "../../../lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const a = await requireApiUser(["admin"]);
  if (!a.user) return a.response;
  try {
    const params = new URL(request.url).searchParams,
      customerId = Number(params.get("customerId")),
      projectId = Number(params.get("projectId"));
    customerFor(a.user, customerId);
    const db = getDb();
    const imports = db
      .prepare(
        "SELECT * FROM conversation_imports WHERE customer_id=? AND (?=0 OR project_id=?) ORDER BY imported_at DESC",
      )
      .all(customerId, projectId, projectId) as Row[];
    const importId = params.get("id") || String(imports[0]?.id || "");
    if (!importId)
      return Response.json({
        imports: [],
        items: [],
        files: [],
        hasMore: false,
      });
    if (!imports.some((row) => row.id === importId))
      throw new Error("此迁移记录不属于当前客户或项目");
    const offset = Math.max(
      0,
      Math.min(100000, Number(params.get("offset")) || 0),
    );
    const items = db
      .prepare(
        "SELECT source_item_id,source_turn_id,role,phase,body,recorded_at,ordinal FROM imported_chat_items WHERE import_id=? ORDER BY ordinal LIMIT 100 OFFSET ?",
      )
      .all(importId, offset);
    const total = Number(
      (
        db
          .prepare(
            "SELECT COUNT(*) n FROM imported_chat_items WHERE import_id=?",
          )
          .get(importId) as { n: number }
      ).n,
    );
    const files = db
      .prepare(
        "SELECT k.id,k.original_name,k.scope,k.can_send,k.is_current,f.original_path,f.role,f.sha256 FROM imported_files f JOIN knowledge_files k ON k.id=f.file_id WHERE f.import_id=? ORDER BY f.original_path",
      )
      .all(importId);
    return Response.json(
      {
        imports,
        importId,
        items,
        files,
        total,
        hasMore: offset + items.length < total,
        note: "这是用户与Codex的历史讨论，不是客户原话或实际邮件投递证据。仅管理员可见；轮次时间不等于邮件发送时间。",
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
