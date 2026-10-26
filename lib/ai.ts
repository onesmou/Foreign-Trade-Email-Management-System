import "server-only";
import { getDb } from "./db";
import { decryptSecret } from "./security";

export type ApiStyle = "chat" | "responses";
export type ProviderConfig = { id?: number; name: string; providerKey: string; apiStyle: ApiStyle; baseUrl: string; model: string; apiKey: string };
export type AiMessage = { role: "system" | "user" | "assistant"; content: string };

export const providerPresets = [
  { key: "anthropic", name: "Anthropic Claude", apiStyle: "chat" as const, baseUrl: "https://api.anthropic.com/v1", model: "", keyRequired: true, note: "原生 Anthropic 协议；填写账号可用模型，不经 OpenAI 兼容网关" },
  { key: "gemini", name: "Google Gemini", apiStyle: "chat" as const, baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "", keyRequired: true, note: "原生 Google 协议；填写账号可用的模型" },
  { key: "openai", name: "OpenAI", apiStyle: "responses" as const, baseUrl: "https://api.openai.com/v1", model: "gpt-5.6-terra", keyRequired: true, note: "适合高质量客户分析与英文商务回复" },
  { key: "deepseek", name: "DeepSeek 深度求索", apiStyle: "chat" as const, baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", keyRequired: true, note: "国产模型，支持 OpenAI Chat Completions 协议" },
  { key: "qwen", name: "通义千问 Qwen", apiStyle: "chat" as const, baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3.7-plus", keyRequired: true, note: "阿里云百炼国内节点；也可填写工作空间专属地址" },
  { key: "kimi", name: "Kimi（月之暗面）", apiStyle: "chat" as const, baseUrl: "https://api.moonshot.cn/v1", model: "kimi-k3", keyRequired: true, note: "中文资料理解和长文档能力强" },
  { key: "doubao", name: "豆包（火山方舟）", apiStyle: "chat" as const, baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "请填写模型或推理接入点ID", keyRequired: true, note: "使用方舟 API Key 和控制台中的模型/接入点 ID" },
  { key: "ollama", name: "本地模型 Ollama", apiStyle: "chat" as const, baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", keyRequired: false, note: "与系统部署在同一服务器时可用，无需外发资料" },
  { key: "custom", name: "自定义兼容接口", apiStyle: "chat" as const, baseUrl: "https://", model: "", keyRequired: false, note: "支持其他 OpenAI 兼容服务和模型网关" },
];

export function listProviders() {
  return (getDb().prepare(`SELECT id,name,provider_key,api_style,base_url,model,enabled,is_active,
    last_test_status,last_test_message,last_test_at,api_key_cipher FROM ai_providers ORDER BY is_active DESC,id DESC`).all() as Array<Record<string, unknown>>)
    .map((row) => ({ ...row, api_key_cipher: undefined, has_key: Boolean(row.api_key_cipher) }));
}

export function activeProvider(): ProviderConfig | null {
  const row = getDb().prepare("SELECT * FROM ai_providers WHERE is_active=1 AND enabled=1 ORDER BY id DESC LIMIT 1").get() as Record<string, string | number> | undefined;
  if (!row) return null;
  return { id: Number(row.id), name: String(row.name), providerKey: String(row.provider_key), apiStyle: row.api_style as ApiStyle, baseUrl: String(row.base_url), model: String(row.model), apiKey: decryptSecret(String(row.api_key_cipher || "")) };
}

export function providerFor(task:"chat"|"analysis"|"translation"|"vision"){
  const route=getDb().prepare("SELECT p.* FROM ai_task_routes r JOIN ai_providers p ON p.id=r.provider_id WHERE r.task=?").get(task) as Record<string,string|number>|undefined;
  if(!route)return activeProvider();if(!route.enabled)throw new Error(`为${task}配置的模型已停用，请调整任务分工；未自动转交其他服务商`);
  return{id:Number(route.id),name:String(route.name),providerKey:String(route.provider_key),apiStyle:route.api_style as ApiStyle,baseUrl:String(route.base_url),model:String(route.model),apiKey:decryptSecret(String(route.api_key_cipher||""))};
}

export async function callModel(config: ProviderConfig, messages: AiMessage[], options?: { json?: boolean; maxTokens?: number; timeoutMs?: number }) {
  validateProvider(config);
  if(["anthropic","gemini"].includes(config.providerKey)){
    const {generateText}=await import("ai");const {sdkModel}=await import("./model");
    const result=await generateText({model:sdkModel(config),messages,maxOutputTokens:options?.maxTokens||3500,maxRetries:0,abortSignal:AbortSignal.timeout(options?.timeoutMs||90000)});return result.text;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs || 90_000);
  try {
    const endpoint = `${config.baseUrl.replace(/\/$/, "")}/${config.apiStyle === "responses" ? "responses" : "chat/completions"}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    const body = config.apiStyle === "responses"
      ? { model: config.model, input: messages,store:false, max_output_tokens: options?.maxTokens || 3500 }
      : { model: config.model, messages, max_tokens: options?.maxTokens || 3500, ...(options?.json ? { response_format: { type: "json_object" } } : {}) };
    const response = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: controller.signal });
    const raw = await response.text();
    if (!response.ok) throw new Error(friendlyProviderError(response.status, raw));
    let payload: Record<string, unknown>;
    try { payload = JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error("模型接口返回了无法识别的数据"); }
    const text = extractText(payload, config.apiStyle);
    if (!text) throw new Error("模型连接成功，但没有返回正文");
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("连接模型超时，请检查地址、网络或模型名称");
    throw error;
  } finally { clearTimeout(timeout); }
}

export async function testProvider(config: ProviderConfig) {
  const started = Date.now();
  const answer = await callModel(config, [
    { role: "system", content: "你是API连接测试助手。" },
    { role: "user", content: "请只回复：连接成功" },
  ], { maxTokens: 30, timeoutMs: 45_000 });
  return { latencyMs: Date.now() - started, answer: answer.trim().slice(0, 100) };
}

export function extractJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(cleaned) as T; } catch {
    const start = cleaned.indexOf("{"); const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1)) as T;
    throw new Error("AI 返回内容不是有效 JSON，请重试或更换模型");
  }
}

export function validateProvider(config: ProviderConfig) {
  if (!config.model.trim() || config.model.includes("请填写")) throw new Error("请填写有效的模型名称或接入点 ID");
  let url: URL;
  try { url = new URL(config.baseUrl); } catch { throw new Error("API 地址格式不正确"); }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname)) && process.env.ALLOW_LOCAL_AI !== "1") {
    throw new Error("为保护服务器，远程 API 必须使用 HTTPS；内网 HTTP 需设置 ALLOW_LOCAL_AI=1");
  }
  const preset = providerPresets.find((item) => item.key === config.providerKey);
  if (preset?.keyRequired && !config.apiKey) throw new Error("请填写 API Key");
}

function extractText(payload: Record<string, unknown>, style: ApiStyle) {
  if (style === "chat") {
    const choices = payload.choices as Array<{ message?: { content?: string } }> | undefined;
    return choices?.[0]?.message?.content || "";
  }
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = payload.output as Array<{ content?: Array<{ text?: string }> }> | undefined;
  return output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("") || "";
}

function friendlyProviderError(status: number, raw: string) {
  let detail = raw.slice(0, 300);
  try { const parsed = JSON.parse(raw) as { error?: { message?: string } }; detail = parsed.error?.message || detail; } catch { /* use raw */ }
  if (status === 401 || status === 403) return `API Key 或账号权限无效（${status}）：${detail}`;
  if (status === 404) return `API 地址、模型名称或接入点不存在（404）：${detail}`;
  if (status === 429) return `模型额度不足或请求过快（429）：${detail}`;
  return `模型接口请求失败（${status}）：${detail}`;
}
