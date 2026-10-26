import { assertSameOrigin, requireApiUser } from "../../../../lib/auth";
import { listProviders, providerPresets } from "../../../../lib/ai";
import { audit, getDb } from "../../../../lib/db";
import { encryptSecret } from "../../../../lib/security";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireApiUser(["admin"]); if (!auth.user) return auth.response;
  return Response.json({ providers: listProviders(), presets: providerPresets });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(["admin"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const data = await request.json() as { id?: number; name?: string; providerKey?: string; apiStyle?: string; baseUrl?: string; model?: string; apiKey?: string };
    if (!data.name?.trim() || !data.baseUrl?.trim() || !data.model?.trim()) return Response.json({ error: "名称、API地址和模型不能为空" }, { status: 400 });
    const style = data.apiStyle === "responses" ? "responses" : "chat";
    let id = Number(data.id || 0);
    if (id) {
      getDb().prepare("DELETE FROM provider_capabilities WHERE provider_id=?").run(id);
      getDb().prepare("UPDATE ai_providers SET last_test_status='untested',last_test_message='' WHERE id=?").run(id);
      const cipher = data.apiKey ? encryptSecret(data.apiKey.trim()) : null;
      if (cipher) getDb().prepare(`UPDATE ai_providers SET name=?,provider_key=?,api_style=?,base_url=?,model=?,api_key_cipher=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(data.name.trim(), data.providerKey || "custom", style, data.baseUrl.trim().replace(/\/$/, ""), data.model.trim(), cipher, id);
      else getDb().prepare(`UPDATE ai_providers SET name=?,provider_key=?,api_style=?,base_url=?,model=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(data.name.trim(), data.providerKey || "custom", style, data.baseUrl.trim().replace(/\/$/, ""), data.model.trim(), id);
    } else {
      const info = getDb().prepare(`INSERT INTO ai_providers (name,provider_key,api_style,base_url,model,api_key_cipher,created_by) VALUES (?,?,?,?,?,?,?)`)
        .run(data.name.trim(), data.providerKey || "custom", style, data.baseUrl.trim().replace(/\/$/, ""), data.model.trim(), encryptSecret(data.apiKey?.trim() || ""), auth.user.id);
      id = Number(info.lastInsertRowid);
    }
    audit(auth.user.id, "保存AI配置", "ai_provider", String(id), `${data.name} / ${data.model}`);
    return Response.json({ ok: true, id });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "保存失败" }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser(["admin"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const data = await request.json() as { id?: number; active?: boolean; enabled?: boolean };
    const id = Number(data.id); if (!id) return Response.json({ error: "配置ID无效" }, { status: 400 });
    if (data.active) {
      getDb().exec("BEGIN IMMEDIATE");
      try { getDb().prepare("UPDATE ai_providers SET is_active=0").run(); getDb().prepare("UPDATE ai_providers SET is_active=1,enabled=1 WHERE id=?").run(id); getDb().exec("COMMIT"); }
      catch (error) { getDb().exec("ROLLBACK"); throw error; }
    }
    if (typeof data.enabled === "boolean") getDb().prepare("UPDATE ai_providers SET enabled=?,is_active=CASE WHEN ?=0 THEN 0 ELSE is_active END WHERE id=?").run(data.enabled ? 1 : 0, data.enabled ? 1 : 0, id);
    audit(auth.user.id, data.active ? "启用AI配置" : "更新AI配置", "ai_provider", String(id));
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "更新失败" }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  const auth = await requireApiUser(["admin"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    const row = getDb().prepare("SELECT is_active FROM ai_providers WHERE id=?").get(id) as { is_active: number } | undefined;
    if (row?.is_active) return Response.json({ error: "请先启用其他配置，再删除当前配置" }, { status: 400 });
    getDb().prepare("DELETE FROM ai_providers WHERE id=?").run(id);
    audit(auth.user.id, "删除AI配置", "ai_provider", String(id));
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 500 }); }
}
