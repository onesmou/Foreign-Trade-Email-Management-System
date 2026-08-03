import { assertSameOrigin, requireApiUser } from "../../../../lib/auth";
import { ProviderConfig, testProvider } from "../../../../lib/ai";
import { audit, getDb } from "../../../../lib/db";
import { decryptSecret } from "../../../../lib/security";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireApiUser(["admin"]); if (!auth.user) return auth.response;
  let providerId = 0;
  try {
    assertSameOrigin(request);
    const data = await request.json() as { id?: number; name?: string; providerKey?: string; apiStyle?: "chat" | "responses"; baseUrl?: string; model?: string; apiKey?: string };
    providerId = Number(data.id) || 0;
    let config: ProviderConfig;
    if (data.id) {
      const row = getDb().prepare("SELECT * FROM ai_providers WHERE id=?").get(data.id) as Record<string, string | number> | undefined;
      if (!row) return Response.json({ error: "AI配置不存在" }, { status: 404 });
      config = { id: Number(row.id), name: String(row.name), providerKey: String(row.provider_key), apiStyle: row.api_style as "chat" | "responses", baseUrl: String(row.base_url), model: String(row.model), apiKey: data.apiKey?.trim() || decryptSecret(String(row.api_key_cipher || "")) };
    } else config = { name: data.name || "新配置", providerKey: data.providerKey || "custom", apiStyle: data.apiStyle === "responses" ? "responses" : "chat", baseUrl: data.baseUrl || "", model: data.model || "", apiKey: data.apiKey?.trim() || "" };
    const result = await testProvider(config);
    if (data.id) getDb().prepare("UPDATE ai_providers SET last_test_status='success',last_test_message=?,last_test_at=CURRENT_TIMESTAMP WHERE id=?").run(`${result.answer} · ${result.latencyMs}ms`, data.id);
    audit(auth.user.id, "测试AI连接成功", "ai_provider", String(data.id || "new"), `${config.name} / ${result.latencyMs}ms`);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "连接测试失败";
    if (providerId) getDb().prepare("UPDATE ai_providers SET last_test_status='failed',last_test_message=?,last_test_at=CURRENT_TIMESTAMP WHERE id=?").run(message.slice(0, 500), providerId);
    return Response.json({ error: message }, { status: 400 });
  }
}
