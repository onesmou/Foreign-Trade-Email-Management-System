import { assertSameOrigin, requireApiUser } from "../../../lib/auth";
import { activeProvider, providerPresets } from "../../../lib/ai";
import { audit, getDb } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiUser(); if (!auth.user) return auth.response;
  const profile = getDb().prepare("SELECT * FROM company_profile WHERE id=1").get();
  const provider = activeProvider();
  const knowledge = getDb().prepare("SELECT COUNT(*) AS files,COALESCE(SUM(chunk_count),0) AS chunks FROM knowledge_files WHERE status='ready'").get();
  return Response.json({ profile, activeProvider: provider ? { id: provider.id, name: provider.name, model: provider.model, providerKey: provider.providerKey } : null, knowledge, presets: providerPresets, user: auth.user });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser(["admin"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const data = await request.json() as Record<string, string>;
    getDb().prepare(`UPDATE company_profile SET company_name=?,brand=?,sales_email=?,whatsapp=?,website=?,business_summary=?,sales_rules=?,reply_signature=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`)
      .run(data.company_name || "RehabIntl", data.brand || "RehabIntl", data.sales_email || "", data.whatsapp || "", data.website || "", data.business_summary || "", data.sales_rules || "", data.reply_signature || "");
    audit(auth.user.id, "更新公司配置", "company_profile", "1");
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 500 }); }
}
