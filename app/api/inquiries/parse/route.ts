import { assertSameOrigin, requireApiUser } from "../../../../lib/auth";
import { activeProvider, callModel, extractJson } from "../../../../lib/ai";
import { parseRawEmail, ParsedEmail } from "../../../../lib/email";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireApiUser(["admin", "sales"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const { rawEmail } = await request.json() as { rawEmail?: string };
    if (!rawEmail?.trim()) return Response.json({ error: "请粘贴邮件全文" }, { status: 400 });
    const local = parseRawEmail(rawEmail);
    const provider = activeProvider();
    if (!provider) return Response.json({ parsed: local, method: "本地规则识别", warning: local.email ? "" : "未识别到邮箱" });
    try {
      const text = await callModel(provider, [
        { role: "system", content: "从客户邮件全文中提取字段。不要猜测不存在的信息。body必须保留客户真正的邮件正文，去掉邮件客户端的From/To/Subject元数据，但保留客户签名。返回JSON对象：name,email,company,country,phone,subject,body,receivedAt,confidence（0-100）。" },
        { role: "user", content: `本地初步结果：${JSON.stringify(local)}\n\n邮件全文：\n${rawEmail.slice(0, 30000)}` },
      ], { json: true, maxTokens: 2500 });
      const ai = extractJson<Partial<ParsedEmail>>(text);
      const parsed: ParsedEmail = {
        name: ai.name?.trim() || local.name, email: ai.email?.trim().toLowerCase() || local.email,
        company: ai.company?.trim() || local.company, country: ai.country?.trim() || local.country,
        phone: ai.phone?.trim() || local.phone, subject: ai.subject?.trim() || local.subject,
        body: ai.body?.trim() || local.body, receivedAt: ai.receivedAt || local.receivedAt,
        confidence: Number(ai.confidence || Math.max(local.confidence, 88)),
      };
      return Response.json({ parsed, method: `${provider.name} 智能识别` });
    } catch (error) {
      return Response.json({ parsed: local, method: "本地规则识别", warning: `AI识别暂不可用，已使用本地结果：${error instanceof Error ? error.message : "未知错误"}` });
    }
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "识别失败" }, { status: 500 }); }
}
