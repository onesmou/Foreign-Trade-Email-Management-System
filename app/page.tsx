"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Inquiry = {
  id: number; customer_id: number; name: string; email: string; company: string;
  country: string; customer_type: string; stage: string; subject: string; body: string;
  source: string; status: string; priority: string; ai_summary: string; ai_intent: string;
  ai_risk: string; recommended_product: string; lead_score: number; confidence: number;
  reply_subject: string; draft_reply: string; analysis_mode: string; received_at: string;
};

type Settings = { aiConfigured: boolean; provider: string; model: string; inboundConfigured: boolean };

const filters = ["全部", "待分析", "待回复", "草稿完成", "已回复"];

export default function Home() {
  const [items, setItems] = useState<Inquiry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState("全部");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState("");
  const [settings, setSettings] = useState<Settings | null>(null);

  useEffect(() => { void load(); }, []);

  async function load() {
    setLoading(true);
    const [inquiryRes, settingsRes] = await Promise.all([fetch("/api/inquiries"), fetch("/api/settings")]);
    const inquiryData = await inquiryRes.json() as { inquiries?: Inquiry[]; error?: string };
    const settingsData = await settingsRes.json() as Settings;
    const next = inquiryData.inquiries || [];
    setItems(next);
    setSelectedId((current) => current ?? next[0]?.id ?? null);
    setSettings(settingsData);
    setLoading(false);
  }

  const selected = items.find((item) => item.id === selectedId) || null;
  const filtered = useMemo(() => items.filter((item) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || [item.name, item.email, item.company, item.subject, item.country].join(" ").toLowerCase().includes(q);
    const matchesFilter = filter === "全部" ||
      (filter === "待分析" && !item.ai_summary) ||
      (filter === "待回复" && ["New", "Needs reply"].includes(item.status)) ||
      (filter === "草稿完成" && item.status === "Draft ready") ||
      (filter === "已回复" && item.status === "Replied");
    return matchesSearch && matchesFilter;
  }), [items, search, filter]);

  const uniqueCustomers = new Set(items.map((item) => item.email)).size;
  const highValue = items.filter((item) => item.priority === "High").length;
  const pending = items.filter((item) => item.status !== "Replied").length;

  async function analyze() {
    if (!selected) return;
    setAnalyzing(true);
    const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id }) });
    const data = await response.json() as { inquiry?: Inquiry; error?: string; mode?: string };
    if (data.inquiry) {
      setItems((current) => current.map((item) => item.id === data.inquiry!.id ? data.inquiry! : item));
      notify(data.mode === "OpenAI" ? "OpenAI 分析和回复草稿已生成" : "演示分析已生成；配置 API 后将使用真实 AI");
    } else notify(data.error || "分析失败");
    setAnalyzing(false);
  }

  async function markReplied() {
    if (!selected) return;
    const response = await fetch("/api/inquiries", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id, status: "Replied" }) });
    const data = await response.json() as { inquiry?: Inquiry };
    if (data.inquiry) setItems((current) => current.map((item) => item.id === data.inquiry!.id ? data.inquiry! : item));
    notify("已标记为已回复");
  }

  async function copyDraft() {
    if (!selected?.draft_reply) return;
    await navigator.clipboard.writeText(`Subject: ${selected.reply_subject}\n\n${selected.draft_reply}`);
    notify("回复草稿已复制");
  }

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">R</span><span>RehabIntl<small>询盘工作台</small></span></div>
        <nav className="nav-list" aria-label="主要导航">
          <button className="nav-item active"><span>▣</span>询盘收件箱<b>{pending}</b></button>
          <button className="nav-item"><span>♙</span>客户档案<b>{uniqueCustomers}</b></button>
          <button className="nav-item"><span>✦</span>AI 回复库</button>
          <button className="nav-item"><span>◫</span>产品资料</button>
        </nav>
        <div className="sidebar-bottom">
          <div className={`ai-card ${settings?.aiConfigured ? "online" : ""}`}>
            <div className="ai-card-title"><i />AI 助手</div>
            <p>{settings?.aiConfigured ? `${settings.model} 已连接` : "演示模式 · 等待 API 配置"}</p>
            <button onClick={() => setShowSettings(true)}>查看配置</button>
          </div>
          <button className="profile-button"><span>JY</span><div><strong>金誉医疗</strong><small>管理员</small></div><b>•••</b></button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><h1>客户询盘</h1><p>集中处理邮件、判断客户价值并生成回复草稿</p></div>
          <div className="top-actions">
            <button className="icon-button" onClick={() => setShowSettings(true)} aria-label="设置">⚙</button>
            <button className="primary-button" onClick={() => setShowImport(true)}><span>＋</span>录入新邮件</button>
          </div>
        </header>

        <div className="stats-row">
          <Stat label="待处理询盘" value={pending} note="需要跟进" tone="blue" />
          <Stat label="高优先级" value={highValue} note="建议今天回复" tone="amber" />
          <Stat label="客户总数" value={uniqueCustomers} note="自动按邮箱归档" tone="green" />
          <Stat label="AI 草稿" value={items.filter((item) => item.draft_reply).length} note="均需人工确认" tone="violet" />
        </div>

        <div className="content-grid">
          <section className="inbox-panel">
            <div className="search-box"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索客户、公司或主题" /></div>
            <div className="filter-tabs">
              {filters.map((name) => <button key={name} className={filter === name ? "active" : ""} onClick={() => setFilter(name)}>{name}</button>)}
            </div>
            <div className="message-list">
              {loading ? <div className="empty-state">正在载入询盘…</div> : filtered.length === 0 ? <div className="empty-state">没有符合条件的询盘</div> : filtered.map((item) => (
                <button key={item.id} className={`message-card ${selectedId === item.id ? "selected" : ""}`} onClick={() => setSelectedId(item.id)}>
                  <div className="avatar">{initials(item.name)}</div>
                  <div className="message-main">
                    <div className="message-head"><strong>{item.name}</strong><time>{relativeTime(item.received_at)}</time></div>
                    <p className="company-line">{item.company || item.email} · {item.country || "未知国家"}</p>
                    <h3>{item.subject}</h3>
                    <p className="preview">{item.ai_summary || item.body}</p>
                    <div className="message-meta"><Badge value={item.priority} /><span className={`status-dot ${statusClass(item.status)}`}>{statusLabel(item.status)}</span>{item.analysis_mode && <em>{item.analysis_mode === "OpenAI" ? "AI" : "演示"}</em>}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="detail-panel">
            {!selected ? <div className="empty-detail"><span>✉</span><h2>选择一封询盘</h2><p>查看客户信息、分析需求并准备回复。</p></div> : (
              <>
                <div className="detail-header">
                  <div><div className="eyebrow"><Badge value={selected.priority} /><span>{statusLabel(selected.status)}</span></div><h2>{selected.subject}</h2><p>来自 {selected.name} · {formatDate(selected.received_at)}</p></div>
                  <button className="more-button" aria-label="更多操作">•••</button>
                </div>

                <div className="detail-scroll">
                  <section className="customer-strip">
                    <div className="avatar large">{initials(selected.name)}</div>
                    <div className="customer-name"><strong>{selected.name}</strong><span>{selected.company || "公司待补充"}</span></div>
                    <div><small>邮箱</small><a href={`mailto:${selected.email}`}>{selected.email}</a></div>
                    <div><small>国家/地区</small><span>{selected.country || "待确认"}</span></div>
                    <div><small>客户阶段</small><span>{selected.stage}</span></div>
                  </section>

                  <section className="email-card">
                    <div className="section-title"><h3>原始邮件</h3><span>{selected.source}</span></div>
                    <p>{selected.body}</p>
                  </section>

                  {!selected.ai_summary ? (
                    <section className="analysis-cta">
                      <div className="spark">✦</div><div><h3>让 AI 分析这封询盘</h3><p>识别客户类型、购买意向、风险点与匹配产品，并生成英文回复草稿。</p></div>
                      <button className="ai-button" onClick={analyze} disabled={analyzing}>{analyzing ? "正在分析…" : "✦ 开始分析"}</button>
                    </section>
                  ) : (
                    <>
                      <section className="analysis-card">
                        <div className="section-title"><h3><span className="spark mini">✦</span>AI 客户分析</h3><span className="mode-pill">{selected.analysis_mode === "OpenAI" ? "真实 AI" : "演示分析"}</span></div>
                        <p className="summary-text">{selected.ai_summary}</p>
                        <div className="analysis-grid">
                          <Metric label="意向类型" value={selected.ai_intent} />
                          <Metric label="建议产品" value={selected.recommended_product} />
                          <Metric label="线索评分" value={`${selected.lead_score}/100`} progress={selected.lead_score} />
                          <Metric label="判断置信度" value={`${selected.confidence}%`} progress={selected.confidence} />
                        </div>
                        {selected.ai_risk && <div className="risk-box"><b>回复前注意</b><span>{selected.ai_risk}</span></div>}
                      </section>

                      <section className="reply-card">
                        <div className="section-title"><h3>英文回复草稿</h3><div><button onClick={analyze} disabled={analyzing}>重新生成</button><button onClick={copyDraft}>复制</button></div></div>
                        <label>Subject</label><div className="subject-field">{selected.reply_subject}</div>
                        <div className="draft-body">{selected.draft_reply}</div>
                        <div className="reply-footer"><span>发送前请人工核对价格、交期、认证与型号。</span><div><a className="secondary-button" href={`mailto:${selected.email}?subject=${encodeURIComponent(selected.reply_subject)}&body=${encodeURIComponent(selected.draft_reply)}`}>在邮箱中打开</a><button className="primary-button compact" onClick={markReplied}>标记已回复</button></div></div>
                      </section>
                    </>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </section>

      {showImport && <ImportModal onClose={() => setShowImport(false)} onCreated={(inquiry) => { setItems((current) => [inquiry, ...current]); setSelectedId(inquiry.id); setShowImport(false); notify("新询盘已录入"); }} />}
      {showSettings && <SettingsPanel settings={settings} onClose={() => setShowSettings(false)} />}
      {toast && <div className="toast">✓ {toast}</div>}
    </main>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: number; note: string; tone: string }) {
  return <div className="stat-card"><span className={`stat-icon ${tone}`}>{tone === "blue" ? "↥" : tone === "amber" ? "!" : tone === "green" ? "♙" : "✦"}</span><div><p>{label}</p><strong>{value}</strong><small>{note}</small></div></div>;
}

function Metric({ label, value, progress }: { label: string; value: string; progress?: number }) {
  return <div className="metric"><small>{label}</small><strong>{value || "待判断"}</strong>{progress !== undefined && <div className="progress"><i style={{ width: `${progress}%` }} /></div>}</div>;
}

function Badge({ value }: { value: string }) {
  return <span className={`badge ${value.toLowerCase()}`}>{value === "High" ? "高优先" : value === "Low" ? "低优先" : "中优先"}</span>;
}

function ImportModal({ onClose, onCreated }: { onClose: () => void; onCreated: (item: Inquiry) => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const response = await fetch("/api/inquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json() as { inquiry?: Inquiry; error?: string };
    if (data.inquiry) onCreated(data.inquiry); else setError(data.error || "保存失败");
    setSaving(false);
  }
  return <div className="modal-backdrop" onMouseDown={onClose}><form className="modal" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
    <div className="modal-header"><div><h2>录入客户邮件</h2><p>现在可直接粘贴；绑定转发邮箱后可自动进入。</p></div><button type="button" onClick={onClose}>×</button></div>
    <div className="form-grid"><label>客户姓名<input name="name" placeholder="例如：John Smith" /></label><label>客户邮箱 *<input name="email" type="email" required placeholder="john@company.com" /></label><label>公司<input name="company" placeholder="公司名称" /></label><label>国家/地区<input name="country" placeholder="例如：Germany" /></label></div>
    <label>邮件主题 *<input name="subject" required placeholder="粘贴邮件主题" /></label>
    <label>邮件正文 *<textarea name="body" required rows={9} placeholder="粘贴客户原始邮件内容…" /></label>
    <input type="hidden" name="source" value="Manual import" />
    {error && <p className="form-error">{error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving}>{saving ? "正在保存…" : "保存并打开"}</button></div>
  </form></div>;
}

function SettingsPanel({ settings, onClose }: { settings: Settings | null; onClose: () => void }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><aside className="settings-panel" onMouseDown={(e) => e.stopPropagation()}>
    <div className="modal-header"><div><h2>连接与自动化</h2><p>系统已经预留好接口，密钥不会显示在网页中。</p></div><button onClick={onClose}>×</button></div>
    <section className="setting-section"><div className="setting-title"><span className="setting-logo">✦</span><div><h3>AI 分析与回复</h3><p>{settings?.provider || "OpenAI"} · {settings?.model || "gpt-5.6-terra"}</p></div><b className={settings?.aiConfigured ? "connected" : "pending"}>{settings?.aiConfigured ? "已连接" : "待配置"}</b></div>
      <p className="setting-help">配置后，系统会通过 Responses API 分析询盘。未配置时使用带明确标记的演示分析，不会伪装成真实 AI。</p>
      <div className="env-list"><span>OPENAI_API_KEY</span><span>OPENAI_MODEL（可选）</span><span>OPENAI_BASE_URL（兼容接口可选）</span></div>
    </section>
    <section className="setting-section"><div className="setting-title"><span className="setting-logo mail">↳</span><div><h3>邮件自动转入</h3><p>转发服务 / Email Worker</p></div><b className={settings?.inboundConfigured ? "connected" : "pending"}>{settings?.inboundConfigured ? "已连接" : "待绑定"}</b></div>
      <p className="setting-help">邮件服务将标准字段发送到系统入口后，会自动建立客户和询盘。当前仍可用“录入新邮件”直接粘贴。</p>
      <code>POST /api/email/inbound</code>
    </section>
    <section className="setting-section compact-section"><h3>安全规则</h3><ul><li>AI 只生成草稿，默认不自动发送。</li><li>价格、交期、认证、规格必须人工确认。</li><li>客户数据使用独立数据库保存。</li></ul></section>
    <button className="primary-button full" onClick={onClose}>完成</button>
  </aside></div>;
}

function initials(name: string) { return name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase(); }
function relativeTime(value: string) { const diff = Date.now() - new Date(`${value.replace(" ", "T")}Z`).getTime(); const mins = Math.max(1, Math.floor(diff / 60000)); return mins < 60 ? `${mins}分钟前` : mins < 1440 ? `${Math.floor(mins / 60)}小时前` : `${Math.floor(mins / 1440)}天前`; }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(`${value.replace(" ", "T")}Z`)); }
function statusLabel(value: string) { return ({ New: "待分析", "Needs reply": "待回复", "Draft ready": "草稿完成", Replied: "已回复" } as Record<string, string>)[value] || value; }
function statusClass(value: string) { return value === "Replied" ? "done" : value === "Draft ready" ? "draft" : "waiting"; }
