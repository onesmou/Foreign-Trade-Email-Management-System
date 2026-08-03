import { env } from "cloudflare:workers";
import { ensureDatabase } from "../../../db/ensure";

export const dynamic = "force-dynamic";

const productContext = [
  "Seated Trunk Stability Trainer", "Seated Hip Trainer", "Seated Quadriceps Trainer",
  "Adult Suspension Rehabilitation System", "Body Weight Support Gait Trainer",
  "Elephant-Arm Body Weight Support Trainer", "Parallel Bars with Accessories",
  "Two-Sided Training Stairs", "Foldable Four-Wheel Walking Aid",
  "Mobile Shoulder Rotation Trainer", "Quadriceps Training Chair",
  "Single-User Standing Frame", "Recumbent Magnetic Lower Limb Exercise Bike",
  "Pediatric Rehabilitation equipment", "Therapy Tables & Beds",
];

type Analysis = {
  summary: string;
  intent: string;
  priority: "High" | "Medium" | "Low";
  risk: string;
  recommendedProduct: string;
  leadScore: number;
  confidence: number;
  replySubject: string;
  draftReply: string;
};

export async function POST(request: Request) {
  try {
    const { id } = await request.json() as { id?: number };
    if (!id) return Response.json({ error: "Inquiry id is required." }, { status: 400 });
    const db = await ensureDatabase();
    const inquiry = await db.prepare(`SELECT i.*, c.name, c.email, c.company, c.country
      FROM inquiries i JOIN customers c ON c.id=i.customer_id WHERE i.id=?`).bind(id).first<Record<string, string | number>>();
    if (!inquiry) return Response.json({ error: "Inquiry not found." }, { status: 404 });

    const runtime = env as unknown as Record<string, string | undefined>;
    let analysis: Analysis;
    let mode = "Demo";
    if (runtime.OPENAI_API_KEY) {
      analysis = await analyzeWithOpenAI(inquiry, runtime);
      mode = "OpenAI";
    } else {
      analysis = demoAnalysis(inquiry);
    }

    await db.prepare(`UPDATE inquiries SET ai_summary=?, ai_intent=?, priority=?, ai_risk=?,
      recommended_product=?, lead_score=?, confidence=?, reply_subject=?, draft_reply=?,
      analysis_mode=?, status='Draft ready', updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .bind(analysis.summary, analysis.intent, analysis.priority, analysis.risk,
        analysis.recommendedProduct, analysis.leadScore, analysis.confidence,
        analysis.replySubject, analysis.draftReply, mode, id).run();
    const updated = await db.prepare(`SELECT i.*, c.name, c.email, c.company, c.country, c.customer_type, c.stage
      FROM inquiries i JOIN customers c ON c.id=i.customer_id WHERE i.id=?`).bind(id).first();
    return Response.json({ inquiry: updated, mode });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Analysis failed." }, { status: 500 });
  }
}

async function analyzeWithOpenAI(inquiry: Record<string, string | number>, runtime: Record<string, string | undefined>): Promise<Analysis> {
  const baseUrl = (runtime.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${runtime.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: runtime.OPENAI_MODEL || "gpt-5.6-terra",
      reasoning: { effort: "low" },
      safety_identifier: "rehabintl-crm-owner",
      input: [
        { role: "system", content: `You are RehabIntl's senior international rehabilitation-equipment sales assistant. Analyze inbound B2B inquiries and write a concise, professional English reply. Never invent price, certification, stock, lead time, warranty terms or product specifications. Ask targeted questions when facts are missing. The reply must remain a draft for human approval. Available product context: ${productContext.join(", ")}. Return only valid JSON.` },
        { role: "user", content: `Customer: ${inquiry.name} | ${inquiry.company} | ${inquiry.country}\nSubject: ${inquiry.subject}\nEmail:\n${inquiry.body}\n\nReturn: summary in Chinese; intent in English; priority High/Medium/Low; risk in Chinese; recommendedProduct; leadScore 0-100; confidence 0-100; replySubject; draftReply in English.` },
      ],
      text: {
        format: {
          type: "json_schema", name: "inquiry_analysis", strict: true,
          schema: {
            type: "object", additionalProperties: false,
            properties: {
              summary: { type: "string" }, intent: { type: "string" },
              priority: { type: "string", enum: ["High", "Medium", "Low"] },
              risk: { type: "string" }, recommendedProduct: { type: "string" },
              leadScore: { type: "integer", minimum: 0, maximum: 100 },
              confidence: { type: "integer", minimum: 0, maximum: 100 },
              replySubject: { type: "string" }, draftReply: { type: "string" },
            },
            required: ["summary", "intent", "priority", "risk", "recommendedProduct", "leadScore", "confidence", "replySubject", "draftReply"],
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status}).`);
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("");
  if (!text) throw new Error("OpenAI returned no analysis.");
  return JSON.parse(text) as Analysis;
}

function demoAnalysis(inquiry: Record<string, string | number>): Analysis {
  const body = `${inquiry.subject} ${inquiry.body}`.toLowerCase();
  const distributor = /distribut|dealer|exclusive|cooperation/.test(body);
  const gait = /gait|walking|walk trainer/.test(body);
  const pediatric = /pediatric|children|child/.test(body);
  const quote = /quote|quotation|price|cost/.test(body);
  const quantity = /\b\d+\b|project|tender|department|hospital/.test(body);
  const recommendedProduct = gait ? "Body Weight Support Gait Trainer" : pediatric ? "Pediatric Rehabilitation starter package" : distributor ? "RehabIntl full product catalog" : "RehabIntl rehabilitation equipment range";
  const intent = distributor ? "Distributor cooperation" : quote ? "Quotation request" : "Product consultation";
  const leadScore = Math.min(94, 55 + (quote ? 16 : 0) + (quantity ? 14 : 0) + (distributor ? 10 : 0));
  const name = String(inquiry.name || "Sir or Madam");
  const salutation = name.includes(" ") ? `Dear ${name},` : `Dear ${name},`;
  const questions = distributor
    ? "Could you please share your main sales channels, current rehabilitation product portfolio, target markets, expected annual purchasing volume, and the product categories you are most interested in?"
    : gait
      ? "Could you please confirm the expected patient weight range, required functions, destination city, intended quantity, and whether on-site installation is needed?"
      : pediatric
        ? "Could you please share the children's age range, room dimensions, target budget, destination city, and the therapies you plan to provide?"
        : "Could you please confirm the intended application, quantity, destination city, required specifications, and purchasing timeline?";
  return {
    summary: distributor ? "客户希望洽谈区域经销合作，关注目录、经销价格、MOQ和独家政策，需先核实渠道能力与预计采购量。" : `客户对${recommendedProduct}感兴趣，需求较明确；报价前仍需补充数量、配置、目的地和时间计划。`,
    intent,
    priority: leadScore >= 80 ? "High" : "Medium",
    risk: "尚未确认具体型号、数量、交付地址及关键技术要求；回复中不要承诺价格、认证或交期。",
    recommendedProduct,
    leadScore,
    confidence: 86,
    replySubject: `Re: ${inquiry.subject}`,
    draftReply: `${salutation}\n\nThank you for contacting RehabIntl and for sharing your requirements. We appreciate your interest in ${recommendedProduct}.\n\n${questions}\n\nOnce we receive these details, we will prepare a suitable recommendation and quotation for your review.\n\nBest regards,\nRehabIntl Sales Team`,
  };
}
