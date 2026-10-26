import { z } from "zod";
import { assertSameOrigin, clientIp } from "../../../../lib/auth";
import { normalizePhone } from "../../../../lib/crm";
import {
  formToken,
  intakeSource,
  limitIntake,
  saveIntake,
  validWebhook,
  verifyFormToken,
} from "../../../../lib/intake";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const shape = z.object({
  requestId: z.string().regex(/^[a-zA-Z0-9-]{16,80}$/),
  name: z.string().trim().min(1).max(100),
  email: z.union([z.email(), z.literal("")]).default(""),
  phone: z.string().max(30).default(""),
  company: z.string().max(200).default(""),
  message: z.string().trim().min(5).max(10000),
  context: z.string().max(600).default(""),
  token: z.string().max(180).default(""),
  website: z.string().max(200).default(""),
});
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const s = intakeSource((await ctx.params).id);
    return Response.json(
      { name: s.name, token: formToken(s) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "咨询入口不可用" }, { status: 404 });
  }
}
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const s = intakeSource((await ctx.params).id);
    if (Number(request.headers.get("content-length")) > 32000)
      throw new Error("内容过长");
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 32000) throw new Error("内容过长");
    const d = shape.parse(JSON.parse(raw));
    limitIntake(String(s.id), clientIp(request));
    if (d.website) return Response.json({ ok: true }, { status: 202 });
    const secret = request.headers.get("x-intake-secret");
    if (secret) {
      if (!validWebhook(s, secret))
        return Response.json({ error: "未授权" }, { status: 401 });
    } else {
      assertSameOrigin(request);
      verifyFormToken(s, d.token);
    }
    if (!d.email && !d.phone) throw new Error("请至少填写邮箱或国际手机号");
    if (
      d.phone &&
      (normalizePhone(d.phone).length < 7 ||
        normalizePhone(d.phone).length > 15)
    )
      throw new Error("手机号无效");
    saveIntake(s, d);
    return Response.json(
      {
        ok: true,
        message:
          "Thank you. Your inquiry has been received. 感谢咨询，我们会尽快回复。",
      },
      { status: 202 },
    );
  } catch (e) {
    const text = (e as Error).message;
    return Response.json(
      {
        error: text.includes("频繁")
          ? text
          : "提交未完成，请检查联系方式或刷新咨询页面后重试",
      },
      { status: text.includes("频繁") ? 429 : 400 },
    );
  }
}
