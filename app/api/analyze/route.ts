import { assertSameOrigin, requireApiUser } from "../../../lib/auth";
import { activeProvider, callModel, extractJson } from "../../../lib/ai";
import { audit, getDb } from "../../../lib/db";
import { retrieveKnowledge } from "../../../lib/knowledge";
import {customerFor} from "../../../lib/crm";

export const runtime = "nodejs";

type Analysis = { summary: string; intent: string; priority: "高" | "中" | "低"; risk: string; recommendedProduct: string; leadScore: number; confidence: number; bodyTranslation: string; replySubject: string; draftReply: string; draftTranslation: string };

export async function POST(request: Request) {
  const auth = await requireApiUser(["admin", "sales"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const { id } = await request.json() as { id?: number };
    if (!id) return Response.json({ error: "询盘ID无效" }, { status: 400 });
    const db = getDb();
    const inquiry = db.prepare(`SELECT i.*,c.name,c.email,c.company,c.country,c.customer_type,c.stage FROM inquiries i JOIN customers c ON c.id=i.customer_id WHERE i.id=?`).get(id) as Record<string, string | number> | undefined;
    if (!inquiry) return Response.json({ error: "询盘不存在" }, { status: 404 });
    customerFor(auth.user,Number(inquiry.customer_id));
    const profile = db.prepare("SELECT * FROM company_profile WHERE id=1").get() as Record<string, string>;
    const knowledge = retrieveKnowledge(`${inquiry.subject}\n${inquiry.body}`, 8,auth.user,Number(inquiry.customer_id));
    const provider = activeProvider();
    let analysis: Analysis; let mode = "本地规则";
    if (provider) { analysis = await analyzeWithProvider(provider, inquiry, profile, knowledge); mode = provider.name; }
    else analysis = localAnalysis(inquiry, profile);
    analysis.leadScore = clamp(analysis.leadScore); analysis.confidence = clamp(analysis.confidence);
    if (!(["高", "中", "低"] as string[]).includes(analysis.priority)) analysis.priority = "中";
    const sourceSummary = [...new Map(knowledge.map((item) => [item.fileId, { id: item.fileId, name: item.name, path: item.sourcePath, category: item.category }])).values()];
    db.prepare(`UPDATE inquiries SET body_translation=?,ai_summary=?,ai_intent=?,priority=?,ai_risk=?,recommended_product=?,lead_score=?,confidence=?,reply_subject=?,draft_reply=?,draft_translation=?,analysis_mode=?,provider_id=?,knowledge_sources=?,status='草稿完成',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
      .run(analysis.bodyTranslation, analysis.summary, analysis.intent, analysis.priority, analysis.risk, analysis.recommendedProduct, analysis.leadScore, analysis.confidence, analysis.replySubject, analysis.draftReply, analysis.draftTranslation, mode, provider?.id || null, JSON.stringify(sourceSummary), auth.user.id, id);
    const updated = db.prepare(`SELECT i.*,c.name,c.email,c.company,c.country,c.phone,c.customer_type,c.stage,p.name AS provider_name FROM inquiries i JOIN customers c ON c.id=i.customer_id LEFT JOIN ai_providers p ON p.id=i.provider_id WHERE i.id=?`).get(id);
    audit(auth.user.id, "生成询盘分析与回复", "inquiry", String(id), `${mode} / 引用${sourceSummary.length}份资料`);
    return Response.json({ inquiry: updated, mode, knowledgeSources: sourceSummary });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "AI分析失败" }, { status: 500 }); }
}

async function analyzeWithProvider(provider: NonNullable<ReturnType<typeof activeProvider>>, inquiry: Record<string, string | number>, profile: Record<string, string>, knowledge: ReturnType<typeof retrieveKnowledge>): Promise<Analysis> {
  const knowledgeText = knowledge.length ? knowledge.map((item, index) => `【资料${index + 1}：${item.name}｜${item.category}】\n${item.content}`).join("\n\n") : "当前知识库没有匹配资料。";
  const text = await callModel(provider, [
    { role: "system", content: `你是${profile.company_name || "RehabIntl"}的资深康复医疗设备外贸销售助理。根据客户邮件和检索到的公司资料，分析客户并生成可人工审核的英文回复草稿。\n硬性规则：1. 不得编造价格、库存、交期、认证、质保、技术参数或独家政策；2. 资料未提供的事实必须向客户询问或说明待确认；3. 回复专业、自然、简洁；4. 如果原邮件不是中文，完整翻译为中文；5. 英文回复必须另给完整中文翻译；6. 只使用给定资料，不要把内部文件名告诉客户；7. 返回纯JSON对象。\n公司概况：${profile.business_summary}\n销售规则：${profile.sales_rules}\n署名：${profile.reply_signature}` },
    { role: "user", content: `客户：${inquiry.name}｜${inquiry.company}｜${inquiry.country}｜${inquiry.email}\n主题：${inquiry.subject}\n邮件正文：\n${inquiry.body}\n\n相关公司资料：\n${knowledgeText}\n\n返回字段：summary（中文需求摘要）, intent（中文意向类型）, priority（高/中/低）, risk（中文风险与待确认事项）, recommendedProduct（中文或产品英文名）, leadScore（0-100）, confidence（0-100）, bodyTranslation（原邮件完整中文翻译；原文中文则整理为中文）, replySubject（英文邮件主题）, draftReply（英文回复全文）, draftTranslation（draftReply完整中文翻译）。` },
  ], { json: true, maxTokens: 5200 });
  return extractJson<Analysis>(text);
}

function localAnalysis(inquiry: Record<string, string | number>, profile: Record<string, string>): Analysis {
  const content = `${inquiry.subject} ${inquiry.body}`.toLowerCase();
  const distributor = /distribut|dealer|exclusive|经销|代理/.test(content); const gait = /gait|walking|步态|行走/.test(content); const pediatric = /pediatric|children|child|儿童/.test(content); const quote = /quote|quotation|price|cost|报价|价格/.test(content);
  const product = gait ? "Body Weight Support Gait Trainer" : pediatric ? "儿童康复设备入门配置" : distributor ? "RehabIntl 全系列产品目录" : "康复医疗设备方案";
  const score = Math.min(92, 55 + (quote ? 18 : 0) + (distributor ? 12 : 0) + (/\b\d+\b|project|tender|hospital|项目|医院/.test(content) ? 12 : 0));
  const salutation = String(inquiry.name || "Sir or Madam");
  const questions = distributor ? "Could you please share your sales channels, target markets, current product portfolio and expected annual purchasing volume?" : "Could you please confirm the intended application, quantity, destination city, required specifications and purchasing timeline?";
  const draft = `Dear ${salutation},\n\nThank you for contacting ${profile.brand || "RehabIntl"} and for sharing your requirements. We appreciate your interest in ${product}.\n\n${questions}\n\nOnce we receive these details, we will prepare a suitable recommendation and quotation for your review.\n\n${profile.reply_signature || "Best regards,\nRehabIntl Sales Team"}`;
  return { summary: `客户对${product}有兴趣，报价或方案前仍需确认数量、规格、目的地和采购时间。`, intent: distributor ? "经销合作" : quote ? "询价" : "产品咨询", priority: score >= 80 ? "高" : "中", risk: "尚未确认关键商务和技术条件；未配置AI时不应直接发送此通用草稿。", recommendedProduct: product, leadScore: score, confidence: 70, bodyTranslation: "未配置可用的AI模型，暂不能生成准确的中文全文翻译。", replySubject: `Re: ${inquiry.subject}`, draftReply: draft, draftTranslation: `尊敬的${salutation}：\n\n感谢您联系${profile.brand || "RehabIntl"}并介绍需求。我们重视您对${product}的关注。\n\n为准备合适的建议和报价，请确认应用场景、数量、目的地、所需规格和采购时间。\n\n收到信息后，我们将准备方案供您审核。\n\n${profile.company_name || "RehabIntl"}销售团队` };
}
function clamp(value: number) { return Math.max(0, Math.min(100, Number(value) || 0)); }
