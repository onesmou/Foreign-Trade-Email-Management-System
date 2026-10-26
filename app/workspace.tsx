"use client";

import {
  useState,
  useEffect,
  useRef,
  useEffectEvent,
  type FormEvent,
  type ChangeEvent,
} from "react";
import Link from "next/link";
import NextImage from "next/image";
import { useRouter } from "next/navigation";
import Markdown from "react-markdown";
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  FolderOpen,
  Settings as SettingsIcon,
  Plus,
  Search,
  ArrowLeft,
  ArrowUpRight,
  FileText,
  Download,
  Languages,
  RefreshCw,
  ChevronRight,
  Check,
  Clock,
  Upload,
  ShieldCheck,
  X,
  Mail,
  BookOpen,
} from "lucide-react";
import { SettingsPanel, type Settings } from "./legacy-ui";
import WhatsAppPanel from "./whatsapp-panel";
import ProgressSuggestion from "./progress-suggestion";
import CustomerAccess from "./customer-access";
import ReadinessChecklist from "./readiness-checklist";
import FolderLibrary from "./folder-library";
import WhatsAppInbox from "./whatsapp-inbox";
import IntakeSources from "./intake-sources";
import ImportedHistory from "./imported-history";
import CustomerColumns, {
  CustomerColumn,
  CustomerColumnSeparator,
  PaneExpandButton,
} from "./customer-columns";
import type { CustomerPane } from "../lib/customer-layout";
import CompanyMark from "./company-mark";
import { companyBrand } from "../lib/branding";
import ChatComposer, { SavedChatImages } from "./chat-composer";
import "./workspace.css";
import "./readability.css";

type RecordRow = { id: number; [key: string]: string | number | null };
type Customer = RecordRow & {
  name: string;
  email: string;
  company: string;
  phone: string;
  country: string;
  first_source: string;
  next_action: string;
  latest_message: string;
};
type Project = RecordRow & {
  title: string;
  stage: string;
  product: string;
  quantity: string;
  destination: string;
  waiting_on: string;
  next_action: string;
  follow_up: string;
  auto_progress: number;
  follow_up_days: number;
};
type Message = RecordRow & {
  channel: string;
  direction: string;
  subject: string;
  body: string;
  translation: string;
  send_status: string;
  occurred_at: string;
  project_id: number;
  wa_message_id: number | null;
  media_name: string | null;
  media_available: number | null;
  progress_state: string;
  progress_error: string;
};
type Source = {
  fileId: number;
  name: string;
  category: string;
  sourcePath: string;
  url: string;
  version: number;
  canAttach: boolean;
};
type Chat = RecordRow & {
  role: string;
  content: string;
  status: string;
  sources: string;
  provider: string;
  project_id: number;
  images: string;
};
type Detail = {
  customer: Customer;
  projects: Project[];
  messages: Message[];
  chat: Chat[];
  memories: RecordRow[];
  attachments: RecordRow[];
  suggestions: (RecordRow & { payload: string; evidence_id: number })[];
};
type View =
  "dashboard" | "customers" | "communications" | "library" | "settings";
const channels: Record<string, string> = {
  email: "邮件",
  whatsapp: "WhatsApp",
  website: "网站",
  advertisement: "广告",
  exhibition: "展会",
  referral: "介绍",
  other: "其他",
  note: "内部备注",
};
const sendLabels: Record<string, string> = {
  received: "客户来信",
  draft: "草稿 · 未发送",
  manual_sent: "人工标记已发送",
  synced: "渠道同步记录",
  confirmed_sent: "渠道确认发送",
  note: "内部备注",
  presumed_sent: "推定采用/发送 · 未核实投递",
  superseded: "历史草稿 · 已被替换",
  historical_draft: "历史澄清稿 · 非原始发件",
  accepted: "已提交平台",
  delivered: "已送达",
  read: "已读",
  unknown: "发送结果待确认",
};
const stageOptions = [
  "需求确认",
  "方案准备",
  "已报价",
  "商务沟通",
  "成交",
  "暂停",
  "流失",
];
async function api(url: string, options?: RequestInit) {
  const r = await fetch(url, options);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "请求失败，请重试");
  return d;
}
const post = (body: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
function date(value: unknown) {
  if (!value) return "暂无";
  const s = String(value);
  const d = new Date(s.includes("T") ? s : `${s.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime())
    ? s
    : d.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}
function sourcesOf(raw: string): Source[] {
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

export default function Workspace() {
  const router = useRouter();
  const [view, setView] = useState<View>("dashboard");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [settingsStart, setSettingsStart] = useState<"ai" | "company">("ai");
  const displayBrand = companyBrand(settings?.profile);
  useEffect(() => {
    document.title = `${displayBrand} 客户 AI 工作台`;
  }, [displayBrand]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [projectId, setProjectId] = useState<number>(0);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [importExisting, setImportExisting] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [tab, setTab] = useState("timeline");
  const [mobilePane, setMobilePane] = useState("customer");
  const [focusedPane, setFocusedPane] = useState<CustomerPane | null>(null);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [partial, setPartial] = useState("");
  const [activity, setActivity] = useState("");
  const [liveSources, setLiveSources] = useState<Source[]>([]);
  const [preview, setPreview] = useState<Source | null>(null);
  const [composer, setComposer] = useState<{
    subject: string;
    body: string;
  } | null>(null);
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [translating, setTranslating] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<number | null>(null);
  const canWrite = Boolean(settings && settings.user.role !== "viewer");
  const project =
    detail?.projects.find((p) => p.id === projectId) || detail?.projects[0];
  function notify(s: string) {
    setToast(s);
    window.setTimeout(() => setToast(""), 6500);
  }
  async function load() {
    setError("");
    try {
      const me = await fetch("/api/auth/me");
      if (me.status === 401) {
        router.replace("/login");
        return;
      }
      if (me.status === 409) {
        router.replace("/setup");
        return;
      }
      const [s, c] = await Promise.all([
        api("/api/settings"),
        api("/api/customers"),
      ]);
      setSettings(s);
      setCustomers(c.customers);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  const onLoad = useEffectEvent(load);
  useEffect(() => {
    const startup = setTimeout(() => void onLoad(), 0);
    return () => {
      clearTimeout(startup);
      abortRef.current?.abort();
    };
  }, []);
  async function refreshDetail(id = selectedRef.current) {
    if (!id) return;
    try {
      const d = await api(`/api/customers?id=${id}`);
      if (selectedRef.current !== id) return;
      setDetail(d);
      setProjectId((current) =>
        d.projects.some((p: Project) => p.id === current)
          ? current
          : d.projects[0]?.id || 0,
      );
    } catch (e) {
      notify((e as Error).message);
    }
  }
  function openCustomer(id: number) {
    if (generating) {
      notify("请先停止当前生成，再切换客户");
      return;
    }
    selectedRef.current = id;
    setPrompt("");
    if (focusedPane === "customers") setFocusedPane("detail");
    setSelected(id);
    setDetail(null);
    setView("customers");
    setTab("timeline");
    setMobilePane("customer");
    void refreshDetail(id);
  }
  useEffect(() => {
    chatEnd.current?.scrollIntoView({ block: "nearest" });
  }, [partial, detail?.chat.length]);
  const onRefresh = useEffectEvent(refreshDetail);
  useEffect(() => {
    if (!selected) return;
    const timer = window.setInterval(() => void onRefresh(selected), 12000);
    return () => window.clearInterval(timer);
  }, [selected]);
  const onTranslate = useEffectEvent(translate);
  useEffect(() => {
    if (!autoTranslate || !detail || translating || !canWrite) return;
    const next = detail.messages.find(
      (m) =>
        m.direction === "inbound" && !m.translation && /[a-z]/i.test(m.body),
    );
    if (next) {
      const timer = setTimeout(() => void onTranslate(next.id), 20);
      return () => clearTimeout(timer);
    }
  }, [autoTranslate, detail, translating, canWrite]);
  async function translate(messageId: number, force = false) {
    if (!detail) return;
    setTranslating(messageId);
    try {
      const d = await api(
        "/api/messages",
        post({
          action: "translate",
          customerId: detail.customer.id,
          messageId,
          force,
        }),
      );
      setDetail((current) =>
        current
          ? {
              ...current,
              messages: current.messages.map((m) =>
                m.id === messageId ? { ...m, translation: d.translation } : m,
              ),
            }
          : current,
      );
    } catch (e) {
      notify((e as Error).message);
      setAutoTranslate(false);
    } finally {
      setTranslating(null);
    }
  }
  async function update(data: object) {
    if (!selected) return;
    try {
      const d = await api("/api/customers", {
        ...post({ id: selected, ...data }),
        method: "PATCH",
      });
      setDetail(d);
      notify("已保存");
      void load();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function chat(message = prompt, images: string[] = []) {
    if (!selected || !project || generating) return false;
    const text = message.trim();
    if (!text && !images.length) return false;
    let accepted = false;
    setGenerating(true);
    setPartial("");
    setLiveSources([]);
    setActivity("正在读取客户历史…");
    setPrompt("");
    setMobilePane("ai");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const r = await fetch("/api/chat", {
        ...post({
          customerId: selected,
          projectId: project.id,
          message: text,
          images,
        }),
        signal: ac.signal,
      });
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.error || "AI调用失败");
      }
      accepted = true;
      void refreshDetail();
      const reader = r.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const event = JSON.parse(line.slice(6));
            if (event.event === "delta") setPartial((p) => p + event.text);
            if (event.sources) setLiveSources(event.sources);
            if (event.event === "status") setActivity(event.text);
            if (event.event === "error") notify(event.error);
          }
        }
      }
    } catch (e) {
      if (!accepted) setPrompt(text);
      notify(
        ac.signal.aborted
          ? "已停止生成，部分内容仍会保留"
          : (e as Error).message,
      );
    } finally {
      setGenerating(false);
      setActivity("");
      await refreshDetail();
      setPartial("");
    }
    return accepted;
  }
  async function saveDraft(status: string) {
    if (!composer || !selected || !project) return;
    try {
      await api(
        "/api/messages",
        post({
          customerId: selected,
          projectId: project.id,
          body: composer.body,
          subject: composer.subject,
          status,
        }),
      );
      notify(
        status === "manual_sent"
          ? "已记录为人工标记发送，不是系统发送回执"
          : "草稿已保存，尚未发送",
      );
      setComposer(null);
      void refreshDetail();
    } catch (e) {
      notify((e as Error).message);
    }
  }
  const filtered = customers.filter((c) =>
    [c.name, c.email, c.company, c.phone, c.country, c.latest_message]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const due = customers.filter(
    (c) => c.follow_up && String(c.follow_up) <= today,
  );
  const nav = [
    { id: "dashboard", label: "工作台", icon: LayoutDashboard },
    { id: "customers", label: "客户", icon: Users },
    { id: "communications", label: "沟通", icon: MessageSquare },
    { id: "library", label: "资料库", icon: FolderOpen },
    { id: "settings", label: "设置", icon: SettingsIcon },
  ] as const;
  return (
    <div className={`crm-v2 ${settings?.preview ? "preview-mode" : ""}`}>
      <aside className="v2-sidebar">
        <Link className="v2-brand" href="/">
          <CompanyMark profile={settings?.profile} />
          <div>
            <span className="company-brand-name" title={displayBrand}>
              {displayBrand}
            </span>
            <small>客户 AI 工作台</small>
          </div>
        </Link>
        <nav aria-label="主导航">
          {nav.map((n) => (
            <button
              key={n.id}
              aria-label={n.label}
              className={view === n.id ? "active" : ""}
              onClick={() => {
                setView(n.id);
              }}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === "customers" && <small>{customers.length}</small>}
            </button>
          ))}
        </nav>
        <div className="v2-sidebar-foot">
          <span
            className={settings?.activeProvider ? "v2-dot online" : "v2-dot"}
          />
          <div>
            <strong>{settings?.activeProvider?.name || "AI 尚未连接"}</strong>
            <small>
              {settings?.activeProvider?.model || "到设置中添加你的 API"}
            </small>
          </div>
        </div>
        <button className="v2-account" onClick={() => setShowSettings(true)}>
          <span>{settings?.user.name?.slice(0, 1) || "我"}</span>
          <div>
            {settings?.user.name || "正在加载"}
            <small>
              {settings?.user.role === "admin"
                ? "管理员"
                : settings?.user.role === "sales"
                  ? "业务员"
                  : "只读账号"}
            </small>
          </div>
          <SettingsIcon size={16} />
        </button>
      </aside>
      <main className="v2-main">
        <header className="v2-topbar">
          <div>
            <small>你的外贸客户，一处持续跟进</small>
            <h1>{nav.find((n) => n.id === view)?.label}</h1>
          </div>
          <div className="v2-top-actions">
            <span className="v2-private">
              <ShieldCheck size={15} />
              私有资料与客户记忆
            </span>
            <button
              className="v2-button primary"
              disabled={!canWrite}
              onClick={() => {
                setImportExisting(false);
                setShowImport(true);
              }}
            >
              <Plus size={17} />
              录入新咨询
            </button>
          </div>
        </header>
        {settings?.preview && (
          <div className="v2-preview-banner">
            本地预览环境 · 数据保存在本机；已授权的 AI / WhatsApp
            可能连接真实服务，请勿误发测试消息。
          </div>
        )}
        {error && (
          <div className="v2-alert">
            {error}
            <button onClick={() => void load()}>重试</button>
          </div>
        )}
        {loading ? (
          <div className="v2-empty">
            <RefreshCw className="v2-spin" />
            正在载入工作台…
          </div>
        ) : (
          <>
            {view === "dashboard" && (
              <section className="v2-dashboard">
                <div className="v2-greeting">
                  <div>
                    <p>从下一步开始</p>
                    <h2>今天，继续推进你的客户。</h2>
                    <span>
                      邮件、WhatsApp、产品资料和 AI 对话，放在同一个客户档案里。
                    </span>
                  </div>
                  <button
                    className="v2-button"
                    onClick={() => setView("customers")}
                  >
                    查看全部客户
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="v2-summary">
                  <div>
                    <Users />
                    <span>
                      客户总数<strong>{customers.length}</strong>
                    </span>
                  </div>
                  <div>
                    <Clock />
                    <span>
                      到期跟进<strong>{due.length}</strong>
                    </span>
                  </div>
                  <div>
                    <FolderOpen />
                    <span>
                      已上传资料
                      <strong>{settings?.knowledge.files || 0}</strong>
                    </span>
                  </div>
                </div>
                {settings?.user.role === "admin" && <ReadinessChecklist />}
                <div className="v2-dashboard-columns">
                  <section className="v2-card">
                    <header>
                      <h3>需要跟进</h3>
                      <span>按跟进日期</span>
                    </header>
                    {due.length ? (
                      due.map((c) => (
                        <button
                          className="v2-customer-line"
                          key={c.id}
                          onClick={() => openCustomer(c.id)}
                        >
                          <span className="v2-avatar">
                            {c.avatar ? (
                              <NextImage
                                unoptimized
                                width={36}
                                height={36}
                                src={String(c.avatar)}
                                alt=""
                              />
                            ) : (
                              c.name.slice(0, 1)
                            )}
                          </span>
                          <div>
                            <strong>{c.company || c.name}</strong>
                            <p>{c.next_action}</p>
                          </div>
                          <ChevronRight size={16} />
                        </button>
                      ))
                    ) : (
                      <div className="v2-small-empty">
                        <Check size={24} />
                        <p>暂时没有到期事项</p>
                        <small>在客户项目中设置下一步和跟进日期。</small>
                      </div>
                    )}
                  </section>
                  <section className="v2-card">
                    <header>
                      <h3>最近的客户</h3>
                      <span>{customers.length} 位</span>
                    </header>
                    {customers.slice(0, 6).map((c) => (
                      <button
                        className="v2-customer-line"
                        key={c.id}
                        onClick={() => openCustomer(c.id)}
                      >
                        <span className="v2-avatar">
                          {c.avatar ? (
                            <NextImage
                              unoptimized
                              width={36}
                              height={36}
                              src={String(c.avatar)}
                              alt=""
                            />
                          ) : (
                            c.name.slice(0, 1)
                          )}
                        </span>
                        <div>
                          <strong>{c.company || c.name}</strong>
                          <p>{c.latest_message || "待补充需求"}</p>
                        </div>
                        <ChevronRight size={16} />
                      </button>
                    ))}
                    {!customers.length && (
                      <div className="v2-small-empty">
                        <Mail size={26} />
                        <p>把第一封客户邮件粘贴进来</p>
                        <small>
                          系统会识别客户，建立档案，并保留后续沟通。
                        </small>
                        <button
                          className="v2-button"
                          disabled={!canWrite}
                          onClick={() => setShowImport(true)}
                        >
                          录入邮件全文
                        </button>
                      </div>
                    )}
                  </section>
                </div>
                <div className="v2-quiet-note">
                  <BookOpen size={17} />
                  <p>
                    先把公司产品文件夹上传到资料库。以后与 AI
                    处理客户时，它会自动查找相关资料，无需反复上传。
                  </p>
                  <button onClick={() => setView("library")}>
                    去资料库
                    <ArrowUpRight size={15} />
                  </button>
                </div>
              </section>
            )}
            {view === "customers" && (
              <CustomerColumns
                hasCustomer={Boolean(selected)}
                mobilePane={mobilePane}
                focus={focusedPane}
                onFocusChange={setFocusedPane}
                userKey={String(settings?.user.id || "local")}
              >
                <CustomerColumn id="customers">
                  <section className="v2-customer-list">
                    <div className="v2-list-heading">
                      <div className="v2-list-title">
                        <h2>
                          全部客户 <small>{customers.length}</small>
                        </h2>
                        <PaneExpandButton pane="customers" />
                      </div>
                      <label className="v2-search">
                        <Search size={16} />
                        <input
                          aria-label="搜索客户"
                          placeholder="搜索姓名、公司或邮箱"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                    </div>
                    <div className="v2-list-scroll">
                      {filtered.map((c) => (
                        <button
                          className={`v2-customer-item ${selected === c.id ? "selected" : ""}`}
                          key={c.id}
                          onClick={() => openCustomer(c.id)}
                        >
                          <div>
                            <span className="v2-avatar">
                              {c.avatar ? (
                                <NextImage
                                  unoptimized
                                  width={36}
                                  height={36}
                                  src={String(c.avatar)}
                                  alt=""
                                />
                              ) : (
                                c.name.slice(0, 1)
                              )}
                            </span>
                            <span>
                              <strong>{c.company || c.name}</strong>
                              <small>
                                {c.company
                                  ? c.name
                                  : c.email || c.phone || "待补充身份"}
                              </small>
                            </span>
                          </div>
                          <p>{c.latest_message || "待补充需求"}</p>
                          <footer>
                            <span>
                              {channels[c.first_source] || c.first_source}
                            </span>
                            <span>{c.country || "国家待确认"}</span>
                          </footer>
                        </button>
                      ))}
                      {!filtered.length && (
                        <div className="v2-small-empty">
                          <Users />
                          <p>{query ? "没有匹配客户" : "还没有客户"}</p>
                        </div>
                      )}
                    </div>
                  </section>
                </CustomerColumn>
                <CustomerColumnSeparator
                  id="customer-list-divider"
                  label="调整全部客户与客户信息宽度"
                />
                {detail ? (
                  <>
                    <CustomerColumn id="detail">
                      <section className="v2-customer-detail">
                        <div className="v2-detail-head">
                          <button
                            className="v2-mobile-back"
                            aria-label="返回客户列表"
                            onClick={() => {
                              selectedRef.current = null;
                              setSelected(null);
                              setDetail(null);
                              if (focusedPane) setFocusedPane("customers");
                            }}
                          >
                            <ArrowLeft size={18} />
                          </button>
                          <div>
                            <h2>
                              {detail.customer.company || detail.customer.name}
                            </h2>
                            <p>
                              {detail.customer.name} ·{" "}
                              {detail.customer.country || "国家待补充"}
                            </p>
                          </div>
                          <button
                            title="刷新记录"
                            className="v2-icon"
                            onClick={() => void refreshDetail()}
                          >
                            <RefreshCw size={16} />
                          </button>
                          <PaneExpandButton pane="detail" />
                        </div>
                        <div className="v2-contact-chips">
                          {detail.customer.email && (
                            <a href={`mailto:${detail.customer.email}`}>
                              {detail.customer.email}
                            </a>
                          )}
                          {detail.customer.phone && (
                            <span>{detail.customer.phone}</span>
                          )}
                          <span>
                            来源：
                            {channels[detail.customer.first_source] ||
                              detail.customer.first_source}
                          </span>
                        </div>
                        <div className="v2-project-select">
                          <select
                            aria-label="当前采购项目"
                            value={project?.id || ""}
                            disabled={generating}
                            onChange={(e) => {
                              setProjectId(Number(e.target.value));
                              setComposer(null);
                            }}
                          >
                            {detail.projects.map((p) => (
                              <option value={p.id} key={p.id}>
                                {p.title}
                              </option>
                            ))}
                          </select>
                          <button
                            disabled={!canWrite || generating}
                            onClick={() => {
                              const title = window.prompt("新采购项目名称");
                              if (title)
                                void update({ action: "newProject", title });
                            }}
                          >
                            <Plus size={15} />
                            项目
                          </button>
                        </div>
                        {project && (
                          <div className="v2-next-step">
                            <span>{project.stage}</span>
                            <div>
                              <small>下一步 · 等待{project.waiting_on}</small>
                              <strong>
                                {project.next_action || "待确定下一步"}
                              </strong>
                            </div>
                            <button onClick={() => setTab("project")}>
                              调整
                            </button>
                          </div>
                        )}
                        {detail.suggestions
                          ?.filter((s) => s.project_id === project?.id)
                          .slice(0, 1)
                          .map((s) => (
                            <ProgressSuggestion
                              key={s.id}
                              suggestion={s}
                              customerId={detail.customer.id}
                              canWrite={canWrite}
                              onRefresh={() => void refreshDetail()}
                              onNotify={notify}
                            />
                          ))}
                        <div className="v2-detail-tabs">
                          {[
                            { id: "timeline", label: "沟通记录" },
                            { id: "project", label: "项目与进度" },
                            { id: "memory", label: "客户记忆" },
                            { id: "files", label: "相关附件" },
                            ...(settings?.user.role === "admin"
                              ? [{ id: "codex", label: "Codex 历史" }]
                              : []),
                          ].map((t) => (
                            <button
                              className={tab === t.id ? "active" : ""}
                              key={t.id}
                              onClick={() => setTab(t.id)}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                        <div className="v2-detail-scroll">
                          {tab === "timeline" && (
                            <>
                              <div className="v2-timeline-actions">
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={autoTranslate}
                                    disabled={!canWrite}
                                    onChange={(e) =>
                                      setAutoTranslate(e.target.checked)
                                    }
                                  />
                                  自动中文翻译
                                </label>
                                <button
                                  disabled={!canWrite}
                                  onClick={() => {
                                    setImportExisting(true);
                                    setShowImport(true);
                                  }}
                                >
                                  <Plus size={14} />
                                  补充沟通
                                </button>
                              </div>
                              {detail.messages.map((m) => (
                                <article
                                  className={`v2-message ${m.direction}`}
                                  key={m.id}
                                >
                                  <header>
                                    <span>
                                      {channels[m.channel] || m.channel} ·{" "}
                                      {sendLabels[m.send_status] ||
                                        m.send_status}
                                    </span>
                                    <time>
                                      {m.occurred_label || date(m.occurred_at)}
                                    </time>
                                  </header>
                                  {m.project_id !== project?.id && (
                                    <small className="v2-other-project">
                                      {m.project_id
                                        ? "其他采购项目的记录"
                                        : "待归类：此客户有多个采购项目"}
                                    </small>
                                  )}
                                  {m.subject && <h4>{m.subject}</h4>}
                                  <p>{m.body}</p>
                                  {m.wa_message_id &&
                                  m.media_available &&
                                  m.media_name ? (
                                    <a
                                      className="wa-media-link"
                                      href={`/api/files/${m.wa_message_id}?source=whatsapp&download=1`}
                                    >
                                      <Download size={15} />
                                      {m.media_name}
                                    </a>
                                  ) : null}
                                  {m.translation && (
                                    <div className="v2-translation">
                                      <small>中文翻译</small>
                                      <p>{m.translation}</p>
                                    </div>
                                  )}
                                  <footer>
                                    {!m.project_id && project && (
                                      <button
                                        disabled={!canWrite}
                                        onClick={async () => {
                                          try {
                                            await api(
                                              "/api/messages",
                                              post({
                                                action: "assign",
                                                customerId: selected,
                                                messageId: m.id,
                                                projectId: project.id,
                                              }),
                                            );
                                            await refreshDetail();
                                            notify("已归入当前项目");
                                          } catch (e) {
                                            notify((e as Error).message);
                                          }
                                        }}
                                      >
                                        归入当前项目
                                      </button>
                                    )}
                                    <button
                                      disabled={
                                        !canWrite || translating === m.id
                                      }
                                      onClick={() =>
                                        void translate(
                                          m.id,
                                          Boolean(m.translation),
                                        )
                                      }
                                    >
                                      <Languages size={14} />
                                      {translating === m.id
                                        ? "正在翻译…"
                                        : m.translation
                                          ? "重新翻译"
                                          : "中文翻译"}
                                    </button>
                                    <button
                                      disabled={!canWrite || generating}
                                      onClick={() =>
                                        void chat(
                                          `请结合沟通记录 #${m.id} 及已知条件，建议下一步并准备客户语言回复和中文对照。`,
                                        )
                                      }
                                    >
                                      帮我回复
                                      <ArrowUpRight size={14} />
                                    </button>
                                  </footer>
                                </article>
                              ))}
                              {!detail.messages.length && (
                                <div className="v2-small-empty">
                                  暂无沟通记录
                                </div>
                              )}
                            </>
                          )}
                          {tab === "codex" &&
                            project &&
                            settings?.user.role === "admin" && (
                              <ImportedHistory
                                key={`${detail.customer.id}:${project.id}`}
                                customerId={detail.customer.id}
                                projectId={project.id}
                                onNotify={notify}
                              />
                            )}
                          {tab === "project" && project && (
                            <>
                              <button
                                className="v2-button"
                                disabled={!canWrite}
                                onClick={async () => {
                                  try {
                                    await api(
                                      "/api/progress",
                                      post({
                                        action: "analyze",
                                        customerId: selected,
                                        projectId: project.id,
                                      }),
                                    );
                                    await refreshDetail();
                                    notify(
                                      "已整理最新真实沟通，请核对建议；自动模式仅处理无事实变更的下一步",
                                    );
                                  } catch (e) {
                                    notify((e as Error).message);
                                  }
                                }}
                              >
                                AI 整理最新进度
                              </button>
                              {(() => {
                                const latest = detail.messages
                                  .filter(
                                    (m) =>
                                      Number(m.project_id) === project.id &&
                                      m.channel !== "note" &&
                                      (m.direction === "inbound" ||
                                        [
                                          "accepted",
                                          "delivered",
                                          "read",
                                          "synced",
                                          "manual_sent",
                                          "confirmed_sent",
                                        ].includes(m.send_status)),
                                  )
                                  .sort(
                                    (a, b) =>
                                      Date.parse(b.occurred_at) -
                                        Date.parse(a.occurred_at) ||
                                      b.id - a.id,
                                  )[0];
                                if (!latest)
                                  return (
                                    <p className="v2-muted">
                                      暂无可分析的真实沟通，草稿不用于推进客户进度。
                                    </p>
                                  );
                                return (
                                  <p role="status" className="v2-muted">
                                    {latest.progress_state === "failed"
                                      ? `进度整理失败：${latest.progress_error}。可点击上方按钮重试。`
                                      : ["queued", "processing"].includes(
                                            latest.progress_state,
                                          )
                                        ? "最新沟通正在等待／进行 AI 整理；需启用分析模型。"
                                        : "AI 只建议下一步，不会自动确认客户已付款或已成交。"}
                                  </p>
                                );
                              })()}
                              <ProjectForm
                                key={`${project.id}-${project.updated_at}`}
                                project={project}
                                canWrite={canWrite}
                                onSave={(d) =>
                                  void update({
                                    action: "project",
                                    projectId: project.id,
                                    ...d,
                                  })
                                }
                              />
                            </>
                          )}
                          {tab === "memory" && (
                            <div className="v2-memories">
                              {settings?.user.role === "admin" && (
                                <CustomerAccess
                                  key={detail.customer.id}
                                  customerId={detail.customer.id}
                                  onNotify={notify}
                                />
                              )}
                              <p className="v2-muted">
                                明确的事实和你的纠正会持续用于后续对话，不依赖模型会话编号。AI
                                建议不会自动变成已确认事实。
                              </p>
                              {detail.memories.map((m) => (
                                <article key={m.id}>
                                  <small>
                                    {m.kind === "user"
                                      ? "用户确认"
                                      : "消息提取"}{" "}
                                    · {date(m.created_at)}
                                  </small>
                                  <p>{m.content}</p>
                                  {canWrite && (
                                    <button
                                      onClick={() =>
                                        void update({
                                          action: "deleteMemory",
                                          memoryId: m.id,
                                        })
                                      }
                                    >
                                      移除此条记忆
                                    </button>
                                  )}
                                </article>
                              ))}
                              {canWrite && (
                                <form
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    const f = e.currentTarget;
                                    const data = new FormData(f);
                                    void update({
                                      action: "memory",
                                      projectId: project?.id,
                                      content: String(data.get("content")),
                                    });
                                    f.reset();
                                  }}
                                >
                                  <label>
                                    补充或纠正客户事实
                                    <textarea
                                      name="content"
                                      required
                                      rows={4}
                                      placeholder="例如：客户已确认需要 10 台，目的地是迪拜。不再重复询问数量。"
                                    />
                                  </label>
                                  <button className="v2-button primary">
                                    保存为记忆
                                  </button>
                                </form>
                              )}
                            </div>
                          )}
                          {tab === "files" && (
                            <div className="v2-attachments">
                              <p className="v2-muted">
                                客户专属文件与 AI
                                引用的资料。内部参考资料不会进入发送附件。
                              </p>
                              {detail.attachments.map((f) => (
                                <FileCard
                                  key={f.id}
                                  source={{
                                    fileId: f.id,
                                    name: String(f.original_name),
                                    category: String(f.category),
                                    version: Number(f.version),
                                    url: `/api/files/${f.id}`,
                                    sourcePath: "",
                                    canAttach: Number(f.can_send) !== 0,
                                  }}
                                  onPreview={setPreview}
                                />
                              ))}
                              {detail.chat
                                .filter((m) => m.role === "assistant")
                                .slice(-5)
                                .flatMap((m) => sourcesOf(m.sources))
                                .filter(
                                  (s, i, all) =>
                                    all.findIndex(
                                      (f) => f.fileId === s.fileId,
                                    ) === i,
                                )
                                .map((s) => (
                                  <FileCard
                                    key={s.fileId}
                                    source={s}
                                    onPreview={setPreview}
                                  />
                                ))}
                              <label className="v2-button">
                                <Upload size={16} />
                                添加客户附件
                                <input
                                  hidden
                                  type="file"
                                  multiple
                                  onChange={(e) => void uploadCustomerFiles(e)}
                                />
                              </label>
                            </div>
                          )}
                        </div>
                        <div className="v2-detail-bottom">
                          <button
                            className="v2-button"
                            disabled={!canWrite}
                            onClick={() =>
                              setComposer({
                                subject: `Re: ${project?.title || "Your inquiry"}`,
                                body: "",
                              })
                            }
                          >
                            <Mail size={15} />
                            准备邮件草稿
                          </button>
                          <button
                            className="v2-button primary v2-open-ai"
                            onClick={() => {
                              setMobilePane("ai");
                              if (focusedPane) setFocusedPane("ai");
                            }}
                          >
                            与 AI 讨论
                            <ArrowUpRight size={16} />
                          </button>
                        </div>
                      </section>
                    </CustomerColumn>
                    <CustomerColumnSeparator
                      id="customer-ai-divider"
                      label="调整客户信息与AI助手宽度"
                    />
                    <CustomerColumn id="ai">
                      <aside className="v2-ai-panel">
                        <header>
                          <div>
                            <span className="v2-ai-mark">✦</span>
                            <h2>客户 AI 助手</h2>
                            <PaneExpandButton pane="ai" />
                          </div>
                          <button
                            className="v2-mobile-back"
                            aria-label="返回客户详情"
                            onClick={() => {
                              setMobilePane("customer");
                              if (focusedPane) setFocusedPane("detail");
                            }}
                          >
                            <X size={18} />
                          </button>
                          <small>
                            {settings?.activeProvider
                              ? `${settings.activeProvider.name} · ${settings.activeProvider.model}`
                              : "尚未配置模型"}
                          </small>
                        </header>
                        <div className="v2-ai-scroll">
                          {!detail.chat.length && !generating && (
                            <div className="v2-ai-welcome">
                              <span>✦</span>
                              <h3>继续这个客户的事。</h3>
                              <p>
                                我会结合客户历史、你的记忆和线上资料，帮你准备下一步。
                              </p>
                              {[
                                "总结当前进度和需要我做的事",
                                "准备回复，自动查找适合的产品资料",
                                "查找本项目已有报价和产品图片",
                              ].map((t) => (
                                <button
                                  key={t}
                                  disabled={!canWrite}
                                  onClick={() => void chat(t)}
                                >
                                  {t}
                                  <ArrowUpRight size={14} />
                                </button>
                              ))}
                            </div>
                          )}
                          {detail.chat
                            .filter(
                              (m) =>
                                m.project_id === project?.id &&
                                !(generating && m.status === "generating"),
                            )
                            .map((m) => (
                              <div className={`v2-chat ${m.role}`} key={m.id}>
                                <small>
                                  {m.role === "user"
                                    ? "你"
                                    : m.provider || "AI 助手"}
                                  {m.status !== "complete" &&
                                    ` · ${m.status === "error" ? "未完成" : m.status === "stopped" ? "已停止" : "生成中"}`}
                                </small>
                                <Markdown>
                                  {m.content || "此条没有生成正文，可重试。"}
                                </Markdown>
                                {m.role === "user" && (
                                  <SavedChatImages value={m.images || "[]"} />
                                )}
                                {m.role === "assistant" && (
                                  <>
                                    <div className="v2-chat-files">
                                      {sourcesOf(m.sources).map((s) => (
                                        <FileCard
                                          key={s.fileId}
                                          source={s}
                                          onPreview={setPreview}
                                        />
                                      ))}
                                    </div>
                                    <footer>
                                      <button
                                        onClick={() => void copy(m.content)}
                                      >
                                        复制
                                      </button>
                                      <button
                                        disabled={!canWrite}
                                        onClick={() =>
                                          setComposer({
                                            subject: `Re: ${project?.title || "Your inquiry"}`,
                                            body: m.content,
                                          })
                                        }
                                      >
                                        编辑为草稿
                                      </button>
                                      {m.status !== "complete" && (
                                        <button
                                          disabled={!canWrite || generating}
                                          onClick={() => {
                                            const prior = detail.chat
                                              .filter(
                                                (c) =>
                                                  c.role === "user" &&
                                                  c.project_id ===
                                                    project?.id &&
                                                  c.id < m.id,
                                              )
                                              .at(-1);
                                            if (prior)
                                              void chat(
                                                prior.content,
                                                JSON.parse(
                                                  prior.images || "[]",
                                                ),
                                              );
                                          }}
                                        >
                                          重试此条
                                        </button>
                                      )}
                                    </footer>
                                  </>
                                )}
                              </div>
                            ))}
                          {generating && (
                            <div className="v2-chat assistant">
                              <small className="v2-generating">
                                <span /> {activity || "正在生成…"}
                              </small>
                              <Markdown>{partial}</Markdown>
                              {liveSources.length > 0 && (
                                <p className="v2-muted">
                                  已找到 {liveSources.length} 份参考资料
                                </p>
                              )}
                            </div>
                          )}
                          <div ref={chatEnd} />
                        </div>
                        <ChatComposer
                          key={`${selected}-${project?.id}`}
                          customerId={selected!}
                          projectId={project?.id || 0}
                          text={prompt}
                          onText={setPrompt}
                          disabled={!canWrite}
                          generating={generating}
                          onStop={() => abortRef.current?.abort()}
                          onSubmit={chat}
                          onNotify={notify}
                          placeholder={
                            settings?.activeProvider
                              ? "告诉我你想怎么回复，或粘贴图片让我看…"
                              : "先到设置添加并启用 AI 接口"
                          }
                        />
                        <p className="v2-ai-disclaimer">
                          仅生成建议和草稿，不会自动发送给客户。
                        </p>
                      </aside>
                    </CustomerColumn>
                  </>
                ) : (
                  <>
                    <CustomerColumn id="detail">
                      <section className="v2-customer-detail">
                        <div className="v2-detail-head">
                          <div>
                            <h2>客户信息</h2>
                          </div>
                          <PaneExpandButton pane="detail" />
                        </div>
                        <div className="v2-empty v2-select-empty">
                          <MessageSquare size={30} />
                          <h2>
                            {selected
                              ? "正在载入客户…"
                              : "选一位客户，继续沟通"}
                          </h2>
                          <p>历史、项目进度、资料和 AI 都在这里。</p>
                        </div>
                      </section>
                    </CustomerColumn>
                    <CustomerColumnSeparator
                      id="customer-ai-divider"
                      label="调整客户信息与AI助手宽度"
                    />
                    <CustomerColumn id="ai">
                      <aside className="v2-ai-panel">
                        <header>
                          <div>
                            <span className="v2-ai-mark">✦</span>
                            <h2>客户 AI 助手</h2>
                            <PaneExpandButton pane="ai" />
                          </div>
                        </header>
                        <div className="v2-empty v2-select-empty">
                          <MessageSquare size={30} />
                          <h2>选择客户后，继续与 AI 沟通</h2>
                          <p>历史、资料和客户记忆会跟随同一份档案。</p>
                        </div>
                      </aside>
                    </CustomerColumn>
                  </>
                )}
              </CustomerColumns>
            )}
            {view === "communications" && (
              <section className="v2-communication-page">
                <WhatsAppInbox
                  customers={customers}
                  canManage={settings?.user.role === "admin"}
                  onNotify={notify}
                  onOpenCustomer={openCustomer}
                />
                <details className="wa-connection-details">
                  <summary>账号连接设置与联系人关联</summary>
                  <WhatsAppPanel
                    customers={customers}
                    canManage={settings?.user.role === "admin"}
                    onNotify={notify}
                    onOpenCustomer={openCustomer}
                  />
                </details>
              </section>
            )}
            {view === "library" && (
              <FolderLibrary
                canWrite={canWrite}
                isAdmin={settings?.user.role === "admin"}
                onNotify={notify}
                onPreview={setPreview}
              />
            )}
            {view === "settings" && (
              <>
                <section className="v2-settings-intro v2-card">
                  <SettingsIcon size={28} />
                  <h2>系统设置</h2>
                  <p>
                    统一管理 AI
                    服务、公司信息、账号权限与备份。高级配置按需打开。
                  </p>
                  <button
                    className="v2-button primary"
                    onClick={() => {
                      setSettingsStart("company");
                      setShowSettings(true);
                    }}
                  >
                    公司信息与 Logo
                  </button>
                  <button
                    className="v2-button"
                    onClick={() => {
                      setSettingsStart("ai");
                      setShowSettings(true);
                    }}
                  >
                    AI 与其他设置
                  </button>
                </section>
                {settings?.user.role === "admin" && (
                  <IntakeSources onNotify={notify} />
                )}
              </>
            )}
          </>
        )}
      </main>
      {showSettings && settings && (
        <SettingsPanel
          settings={settings}
          initialTab={settingsStart}
          onProfileSaved={(profile) =>
            setSettings((current) =>
              current ? { ...current, profile } : current,
            )
          }
          onClose={() => {
            setShowSettings(false);
            void load();
          }}
          onNotify={notify}
        />
      )}
      {showImport && (
        <Intake
          existing={importExisting ? detail : undefined}
          projectId={project?.id}
          onClose={() => setShowImport(false)}
          onSaved={(id) => {
            setShowImport(false);
            void load();
            if (id) openCustomer(id);
          }}
        />
      )}
      {composer && (
        <Dialog
          title="邮件草稿 · 发送前请人工检查"
          onClose={() => setComposer(null)}
        >
          <label>
            主题
            <input
              value={composer.subject}
              onChange={(e) =>
                setComposer({ ...composer, subject: e.target.value })
              }
            />
          </label>
          <label>
            正文
            <textarea
              rows={16}
              value={composer.body}
              onChange={(e) =>
                setComposer({ ...composer, body: e.target.value })
              }
            />
          </label>
          <p className="v2-muted">
            复制或打开邮箱不代表已发送。附件请从资料卡下载后，在邮箱中添加。
          </p>
          <div className="v2-dialog-actions">
            <button
              className="v2-button"
              onClick={() =>
                void copy(`Subject: ${composer.subject}\n\n${composer.body}`)
              }
            >
              复制草稿
            </button>
            <button
              className="v2-button"
              disabled={!composer.body.trim()}
              onClick={() => void saveDraft("draft")}
            >
              保存草稿
            </button>
            <button
              className="v2-button primary"
              disabled={!composer.body.trim()}
              onClick={() => {
                if (
                  window.confirm(
                    "确认你已经在邮箱中手动发送了这封邮件？系统只记录你的确认，不代表收到发送回执。",
                  )
                )
                  void saveDraft("manual_sent");
              }}
            >
              我已在邮箱发送
            </button>
          </div>
        </Dialog>
      )}
      {preview && (
        <Dialog
          title={`${preview.name} · v${preview.version || 1}`}
          onClose={() => setPreview(null)}
        >
          <p className="v2-muted">
            {preview.sourcePath} · {preview.category}
            {!preview.canAttach && " · 内部参考，禁止作为客户附件"}
          </p>
          {/\.(png|jpe?g|webp)$/i.test(preview.name) ? (
            <picture>
              <img
                className="v2-file-image"
                src={preview.url}
                alt={preview.name}
              />
            </picture>
          ) : /\.(pdf|txt|md|csv)$/i.test(preview.name) ? (
            <iframe
              className="v2-file-frame"
              title="原文件预览"
              src={preview.url}
            />
          ) : (
            <div className="v2-small-empty">
              <FileText />
              <p>此格式请下载后使用本地软件查看。</p>
            </div>
          )}
          <a className="v2-button" href={`${preview.url}?download=1`} download>
            <Download size={16} />
            下载原文件
          </a>
        </Dialog>
      )}
      {toast && (
        <div className="v2-toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify("已复制，未标记为发送");
    } catch {
      notify("复制失败，请手动选择文本复制");
    }
  }
  async function uploadCustomerFiles(e: ChangeEvent<HTMLInputElement>) {
    if (!detail || !e.target.files?.length) return;
    const form = new FormData();
    Array.from(e.target.files).forEach((f) => form.append("files", f));
    form.append("scope", "customer");
    form.append("customerId", String(detail.customer.id));
    try {
      const d = await api("/api/knowledge", { method: "POST", body: form });
      notify(`已入库 ${d.imported} 份，后台解析中`);
      void refreshDetail();
    } catch (e) {
      notify((e as Error).message);
    }
  }
}

function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const root = useRef<HTMLElement>(null);
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = root.current;
    const focusable = () =>
      Array.from(
        element?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]',
        ) || [],
      );
    focusable()[0]?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (e.key === "Tab") {
        const list = focusable();
        const first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="v2-dialog-backdrop" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="v2-dialog"
        ref={root}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header>
          <h2>{title}</h2>
          <button aria-label="关闭" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function FileCard({
  source: s,
  onPreview,
}: {
  source: Source;
  onPreview: (s: Source) => void;
}) {
  return (
    <button className="v2-file-card" onClick={() => onPreview(s)}>
      <FileText size={18} />
      <span>
        <strong>{s.name}</strong>
        <small>
          {s.category} · v{s.version || 1}
          {!s.canAttach ? " · 参考资料，未列为可发附件" : " · 可下载原件"}
        </small>
      </span>
      <ArrowUpRight size={14} />
    </button>
  );
}
function ProjectForm({
  project: p,
  canWrite,
  onSave,
}: {
  project: Project;
  canWrite: boolean;
  onSave: (d: object) => void;
}) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    onSave(Object.fromEntries(new FormData(e.currentTarget)));
  }
  return (
    <form className="v2-project-form" onSubmit={submit}>
      <label>
        项目名称
        <input name="title" defaultValue={p.title} required />
      </label>
      <div className="v2-form-grid">
        <label>
          当前阶段
          <select name="stage" defaultValue={p.stage}>
            {stageOptions.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          当前在等谁
          <select name="waiting_on" defaultValue={p.waiting_on}>
            <option>我方</option>
            <option>客户</option>
            <option>第三方</option>
            <option>暂无</option>
          </select>
        </label>
        <label>
          产品 / 型号
          <input name="product" defaultValue={p.product} />
        </label>
        <label>
          数量
          <input name="quantity" defaultValue={p.quantity} />
        </label>
        <label>
          目的地
          <input name="destination" defaultValue={p.destination} />
        </label>
        <label>
          跟进日期
          <input name="follow_up" type="date" defaultValue={p.follow_up} />
        </label>
      </div>
      <label>
        下一步
        <textarea name="next_action" rows={3} defaultValue={p.next_action} />
      </label>
      <div className="v2-form-grid">
        <label>
          新消息进度处理
          <select
            name="auto_progress"
            defaultValue={String(p.auto_progress || 0)}
            disabled={!canWrite}
          >
            <option value="0">建议由我确认（默认）</option>
            <option value="1">无事实变更时自动更新下一步</option>
          </select>
        </label>
        <label>
          等待客户时，几天后跟进
          <input
            name="follow_up_days"
            type="number"
            min={0}
            max={90}
            defaultValue={p.follow_up_days ?? 3}
            disabled={!canWrite}
          />
        </label>
      </div>
      <p className="v2-muted">
        自动模式需要分析模型，只更新无冲突的等待方和下一步。型号、数量、目的地的新增或变更仍需确认；不会自动标记成交或付款。0天表示不自动设置跟进日期。
      </p>
      <button className="v2-button primary" disabled={!canWrite}>
        保存项目进度
      </button>
    </form>
  );
}

function Intake({
  existing,
  projectId,
  onClose,
  onSaved,
}: {
  existing?: Detail | null;
  projectId?: number;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const [raw, setRaw] = useState("");
  const [channel, setChannel] = useState("email");
  const [parsed, setParsed] = useState<Record<string, string> | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [newProject, setNewProject] = useState(false);
  async function parse() {
    setWorking(true);
    setError("");
    try {
      const d = await api("/api/inquiries/parse", post({ rawEmail: raw }));
      setParsed(d.parsed);
      if (d.warning) setError(d.warning);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setWorking(true);
    setError("");
    try {
      const fields = Object.fromEntries(new FormData(e.currentTarget));
      const d = await api(
        "/api/customers",
        post({
          ...parsed,
          ...fields,
          raw,
          channel,
          customerId: existing?.customer.id,
          projectId: newProject ? undefined : existing ? projectId : undefined,
          newProject,
        }),
      );
      onSaved(d.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setWorking(false);
    }
  }
  return (
    <Dialog title={existing ? "补充客户沟通" : "录入新咨询"} onClose={onClose}>
      <p className="v2-muted">
        粘贴完整邮件或其他渠道的咨询。系统按邮箱、电话匹配原客户，不按相似公司名误合并。
      </p>
      <label>
        咨询渠道
        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
          {Object.entries(channels)
            .filter(([k]) => k !== "note")
            .map(([k, v]) => (
              <option value={k} key={k}>
                {v}
              </option>
            ))}
        </select>
      </label>
      <label>
        邮件 / 咨询全文
        <textarea
          rows={parsed ? 5 : 11}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={
            "From: Anna <anna@example.com>\nSubject: Gait trainer inquiry\n\nPlease quote 10 units…"
          }
          autoFocus
        />
      </label>
      <button
        className="v2-button"
        disabled={!raw.trim() || working}
        onClick={() => void parse()}
      >
        {working ? "处理中…" : "识别联系人与正文"}
      </button>
      {(parsed || existing) && (
        <form onSubmit={save}>
          {!existing && (
            <div className="v2-form-grid">
              {[
                { key: "name", label: "姓名" },
                { key: "email", label: "邮箱（可空）" },
                { key: "phone", label: "电话 / WhatsApp（含区号，可空）" },
                { key: "company", label: "公司" },
                { key: "country", label: "国家" },
                { key: "campaign", label: "活动 / 广告来源（可空）" },
              ].map((f) => (
                <label key={f.key}>
                  {f.label}
                  <input
                    name={f.key}
                    defaultValue={parsed?.[f.key] || ""}
                    type={f.key === "email" ? "email" : "text"}
                  />
                </label>
              ))}
            </div>
          )}
          <label>
            主题 / 项目名称
            <input
              name="subject"
              defaultValue={parsed?.subject || "客户咨询"}
            />
          </label>
          {parsed && (
            <label>
              识别出的正文
              <textarea name="body" rows={5} defaultValue={parsed.body} />
            </label>
          )}
          {existing && (
            <label className="v2-check">
              <input
                type="checkbox"
                checked={newProject}
                onChange={(e) => setNewProject(e.target.checked)}
              />
              这次是新的采购项目
            </label>
          )}
          <div className="v2-dialog-actions">
            <button className="v2-button primary" disabled={working}>
              {working
                ? "保存中…"
                : existing
                  ? "保存到此客户"
                  : "确认并建档 / 匹配老客户"}
            </button>
          </div>
        </form>
      )}
      {error && <p className="v2-error">{error}</p>}
      {!existing && (
        <details className="v2-csv-import">
          <summary>导入历史客户 CSV 表格</summary>
          <p className="v2-muted">
            UTF-8 CSV，支持中文或英文字段，每次最多500行。
            <a href="/customer-import-template.csv" download>
              下载模板
            </a>
          </p>
          <input
            type="file"
            accept=".csv"
            disabled={working}
            onChange={async (e) => {
              if (!e.target.files?.[0]) return;
              setWorking(true);
              try {
                const f = new FormData();
                f.append("file", e.target.files[0]);
                const d = await api("/api/customers/import", {
                  method: "POST",
                  body: f,
                });
                if (d.errors.length) window.alert(d.errors.join("\n"));
                onSaved(0);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setWorking(false);
              }
            }}
          />
        </details>
      )}
      <p className="v2-muted">
        无法识别邮箱或电话也可保存为待补充线索；启用模型后，点击识别会将本封咨询发送给当前服务商。
      </p>
    </Dialog>
  );
}
