import { generateText, streamText, tool } from "ai";
import { z } from "zod";
import { requireApiUser, assertSameOrigin } from "../../../../lib/auth";
import { type ProviderConfig } from "../../../../lib/ai";
import { decryptSecret } from "../../../../lib/security";
import { getDb } from "../../../../lib/db";
import { sdkModel } from "../../../../lib/model";
export const runtime = "nodejs";
export async function GET() {
  const a = await requireApiUser(["admin"]);
  if (!a.user) return a.response;
  return Response.json({
    results: getDb().prepare("SELECT * FROM provider_capabilities").all(),
    usage: getDb()
      .prepare(
        "SELECT provider,task,COUNT(*) AS calls,SUM(input_tokens) AS input_tokens,SUM(output_tokens) AS output_tokens FROM ai_usage GROUP BY provider,task",
      )
      .all(),
  });
}
export async function POST(request: Request) {
  const a = await requireApiUser(["admin"]);
  if (!a.user) return a.response;
  let id = 0;
  let capability = "";
  try {
    assertSameOrigin(request);
    const d = await request.json();
    id = Number(d.id);
    capability = String(d.capability);
    if (!["text", "stream", "tools", "structured"].includes(capability))
      throw new Error("请选择文本、流式、工具或结构化测试");
    const db = getDb();
    const p = db.prepare("SELECT * FROM ai_providers WHERE id=?").get(id) as
      Record<string, string> | undefined;
    if (!p) throw new Error("配置不存在");
    const config: ProviderConfig = {
      name: p.name,
      providerKey: p.provider_key,
      apiStyle: p.api_style as "chat" | "responses",
      baseUrl: p.base_url,
      model: p.model,
      apiKey: decryptSecret(p.api_key_cipher),
    };
    const model = sdkModel(config);
    const started = Date.now();
    const base = {
      model,
      maxOutputTokens: 150,
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(45000),
    };
    if (capability === "stream") {
      const r = streamText({ ...base, prompt: "请用中文回复：测试成功" });
      let text = "";
      for await (const chunk of r.textStream) text += chunk;
      if (!text.trim()) throw new Error("未收到文本流");
    } else if (capability === "tools") {
      const r = await generateText({
        ...base,
        prompt: "调用connection_probe工具，参数code填CRM。不要直接输出文字。",
        tools: {
          connection_probe: tool({
            description: "连接测试，不读取真实业务数据",
            inputSchema: z.object({ code: z.string() }),
          }),
        },
        toolChoice: { type: "tool", toolName: "connection_probe" },
      });
      if (!r.toolCalls.some((c) => c.toolName === "connection_probe"))
        throw new Error("服务未返回有效工具调用");
    } else {
      const r = await generateText({
        ...base,
        prompt:
          capability === "structured"
            ? '请只输出合法JSON对象：{"ok":true}'
            : "请回复：测试成功",
      });
      if (!r.text.trim()) throw new Error("没有正文");
      if (capability === "structured") {
        const parsed = JSON.parse(
          r.text.trim().replace(/^```json\s*|\s*```$/g, ""),
        );
        if (parsed.ok !== true) throw new Error("返回JSON不符合结构");
      }
    }
    const detail = `通过 · ${Date.now() - started}ms`;
    db.prepare(
      "INSERT INTO provider_capabilities(provider_id,capability,status,detail) VALUES(?,?,'success',?) ON CONFLICT(provider_id,capability) DO UPDATE SET status='success',detail=excluded.detail,tested_at=CURRENT_TIMESTAMP",
    ).run(id, capability, detail);
    return Response.json({ ok: true, detail });
  } catch (e) {
    const error = (e as Error).message;
    if (
      id &&
      capability &&
      getDb().prepare("SELECT id FROM ai_providers WHERE id=?").get(id)
    )
      getDb()
        .prepare(
          "INSERT INTO provider_capabilities(provider_id,capability,status,detail) VALUES(?,?,'failed',?) ON CONFLICT(provider_id,capability) DO UPDATE SET status='failed',detail=excluded.detail,tested_at=CURRENT_TIMESTAMP",
        )
        .run(id, capability, error.slice(0, 1000));
    return Response.json({ error }, { status: 400 });
  }
}
