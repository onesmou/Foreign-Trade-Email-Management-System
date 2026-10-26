"use client";
import { useState, useEffect, useEffectEvent, useRef } from "react";
import NextImage from "next/image";
import {
  MessageSquare,
  Send,
  Languages,
  RefreshCw,
  ArrowLeft,
  UserPlus,
  Search,
  Download,
} from "lucide-react";
type Contact = {
  jid: string;
  name: string;
  customer_id: number | null;
  preview: string;
  last_time: number;
  incoming: number;
  message_count: number;
  avatar: string;
  avatar_status: string;
  avatar_checked_at: number;
  default_project_id: number | null;
};
type Message = {
  id: number;
  body: string;
  translation: string;
  from_me: number;
  status: string;
  timestamp: number;
  kind: string;
  media_name: string;
  media_size: number;
  media_available: number;
};
type Customer = { id: number; name: string; company: string };
async function request(body?: unknown, jid?: string, before?: number) {
  const r = await fetch(
    `/api/whatsapp/inbox${jid ? `?jid=${encodeURIComponent(jid)}${before ? `&before=${before}` : ""}` : ""}`,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "请求失败");
  return d;
}
const statuses: Record<string, string> = {
  received: "已接收",
  synced: "已同步",
  sending: "发送中",
  accepted: "已提交平台",
  delivered: "已送达",
  read: "已读",
  unknown: "发送结果待确认，请检查手机，不要重复发送",
};
export default function WhatsAppInbox({
  canManage,
  customers,
  onNotify,
  onOpenCustomer,
}: {
  canManage: boolean;
  customers: Customer[];
  onNotify: (s: string) => void;
  onOpenCustomer: (id: number) => void;
}) {
  const [contacts, setContacts] = useState<Contact[]>([]),
    [jid, setJid] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [connected, setConnected] = useState(false);
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [draft, setDraft] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [target, setTarget] = useState(0),
    [more, setMore] = useState(false),
    [language, setLanguage] = useState("英语");
  const [projects, setProjects] = useState<{ id: number; title: string }[]>([]);
  const selectedRef = useRef(""),
    sendRef = useRef<{ jid: string; body: string; id: string } | null>(null);
  const messageArea = useRef<HTMLDivElement>(null),
    previousChat = useRef("");
  async function load() {
    if (!canManage) return;
    try {
      const d = await request();
      setContacts(d.contacts);
      setConnected(d.connected);
      if (selectedRef.current) {
        const selected = selectedRef.current,
          m = await request(undefined, selected);
        if (selectedRef.current === selected) {
          setProjects(m.projects || []);
          if (m.jid && m.jid !== selected) {
            selectedRef.current = m.jid;
            setJid(m.jid);
          }
          setMessages((prev) => {
            const merged = new Map(
              prev.map((message) => [message.id, message]),
            );
            for (const message of m.messages as Message[])
              merged.set(message.id, message);
            return [...merged.values()].sort(
              (a, b) => a.timestamp - b.timestamp || a.id - b.id,
            );
          });
        }
      }
    } catch (e) {
      onNotify((e as Error).message);
    }
  }
  const onLoad = useEffectEvent(load);
  const latest = messages.at(-1)?.id,
    messageCount = messages.length;
  useEffect(() => {
    const area = messageArea.current;
    if (!area || !messageCount) return;
    if (
      previousChat.current !== jid ||
      area.scrollHeight - area.scrollTop - area.clientHeight < 240
    )
      area.scrollTop = area.scrollHeight;
    previousChat.current = jid;
  }, [jid, latest, messageCount]);
  useEffect(() => {
    const first = setTimeout(() => void onLoad(), 0);
    const t = setInterval(() => void onLoad(), 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [canManage]);
  useEffect(() => {
    if (!connected) return;
    const pending = contacts
      .filter(
        (c) => !c.avatar_status || Date.now() - c.avatar_checked_at >= 86400000,
      )
      .slice(0, 3);
    if (!pending.length) return;
    let cancelled = false;
    void Promise.all(
      pending.map((c) => request({ action: "avatar", jid: c.jid })),
    )
      .then(() => {
        if (!cancelled) void onLoad();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connected, contacts]);
  async function choose(value: string) {
    selectedRef.current = value;
    setJid(value);
    setMessages([]);
    setDraft("");
    setConfirm(false);
    setTarget(0);
    setProjects([]);
    try {
      const d = await request(undefined, value);
      if (selectedRef.current === value) {
        setProjects(d.projects || []);
        if (d.jid && d.jid !== value) {
          selectedRef.current = d.jid;
          setJid(d.jid);
        }
        setMessages(d.messages);
        setMore(d.hasMore);
      }
    } catch (e) {
      onNotify((e as Error).message);
    }
  }
  async function action(data: object) {
    setBusy(true);
    try {
      const d = await request({ jid, ...data });
      await load();
      return d;
    } catch (e) {
      onNotify((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  if (!canManage) return null;
  const contact = contacts.find((c) => c.jid === jid),
    visible = contacts.filter(
      (c) =>
        (filter !== "leads" || (!c.customer_id && c.incoming > 0)) &&
        `${c.name} ${c.jid} ${c.preview}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
  return (
    <section className="wa-inbox v2-card">
      <header className="wa-inbox-title">
        <div>
          <h2>
            <MessageSquare size={20} />
            WhatsApp 消息
          </h2>
          <p>
            <span className={connected ? "wa-online" : ""}>
              {connected ? "● 已连接" : "○ 未连接，请展开下方连接设置"}
            </span>{" "}
            · 未关联聊天仅管理员可见
          </p>
        </div>
        <button
          className="v2-button"
          disabled={busy}
          onClick={async () => {
            if (jid) {
              const d = await action({ action: "sync" });
              if (d) onNotify(d.note);
            } else await load();
          }}
        >
          <RefreshCw size={15} />
          刷新
        </button>
      </header>
      <div className={`wa-inbox-layout ${jid ? "has-chat" : ""}`}>
        <aside>
          <label className="v2-search">
            <Search size={15} />
            <input
              aria-label="搜索WhatsApp联系人"
              placeholder="搜索联系人或聊天…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="wa-filters">
            <button
              className={filter === "all" ? "active" : ""}
              onClick={() => setFilter("all")}
            >
              全部
            </button>
            <button
              className={filter === "leads" ? "active" : ""}
              onClick={() => setFilter("leads")}
            >
              待建档{" "}
              {contacts.filter((c) => !c.customer_id && c.incoming > 0).length}
            </button>
          </div>
          <div className="wa-chat-list">
            {visible.map((c) => (
              <button
                className={c.jid === jid ? "active" : ""}
                key={c.jid}
                onClick={() => void choose(c.jid)}
              >
                <span className="wa-avatar">
                  {c.avatar ? (
                    <NextImage
                      unoptimized
                      width={40}
                      height={40}
                      src={c.avatar}
                      alt=""
                    />
                  ) : (
                    (c.name || "W").slice(0, 1)
                  )}
                </span>
                <div>
                  <strong>{c.name || c.jid.split("@")[0]}</strong>
                  <small>{c.preview || "联系人已同步，尚无下发的消息"}</small>
                </div>
                <span className="wa-chat-badge">
                  {c.customer_id
                    ? "客户"
                    : c.incoming > 0
                      ? "待建档"
                      : "联系人"}
                </span>
              </button>
            ))}
            {!visible.length && (
              <p className="wa-placeholder">
                尚无聊天。连接后等待平台同步；不是所有手机历史都会自动下发。
              </p>
            )}
          </div>
        </aside>
        <main>
          {!contact ? (
            <div className="wa-empty">
              <MessageSquare size={38} />
              <h3>选择左侧聊天，查看并回复消息</h3>
              <p>
                新咨询先进入待建档。关联原客户后，邮件和 WhatsApp
                会进入同一客户档案。
              </p>
            </div>
          ) : (
            <>
              <header className="wa-chat-header">
                <button
                  className="v2-button wa-back"
                  onClick={() => {
                    selectedRef.current = "";
                    setJid("");
                  }}
                  aria-label="返回聊天列表"
                >
                  <ArrowLeft size={16} />
                </button>
                <div>
                  <strong>{contact.name || contact.jid.split("@")[0]}</strong>
                  <small>
                    {contact.jid.endsWith("@lid")
                      ? "平台隐私ID，不按此ID猜测手机号"
                      : contact.jid.split("@")[0]}
                  </small>
                </div>
                <button
                  className="v2-button"
                  disabled={busy || !connected}
                  title={contact.avatar_status || "同步平台可见头像"}
                  onClick={() => void action({ action: "avatar", force: true })}
                >
                  同步头像
                </button>
                {contact.customer_id ? (
                  <button
                    className="v2-button"
                    onClick={() => onOpenCustomer(contact.customer_id!)}
                  >
                    客户档案 / AI 助手
                  </button>
                ) : (
                  <div className="wa-adopt">
                    <select
                      aria-label="关联WhatsApp客户"
                      value={target}
                      onChange={(e) => setTarget(Number(e.target.value))}
                    >
                      <option value={0}>新建客户档案</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          关联：{c.name} {c.company}
                        </option>
                      ))}
                    </select>
                    <button
                      className="v2-button"
                      disabled={busy}
                      onClick={async () => {
                        const d = await action({
                          action: "adopt",
                          customerId: target,
                        });
                        if (d) onNotify("已关联客户；消息已归入该客户沟通记录");
                      }}
                    >
                      <UserPlus size={14} />
                      确认建档
                    </button>
                  </div>
                )}
              </header>
              {contact.customer_id && (
                <div className="wa-history">
                  <label>
                    此聊天的新消息归属
                    <select
                      aria-label="WhatsApp默认采购项目"
                      disabled={busy}
                      value={
                        projects.some(
                          (p) => p.id === contact.default_project_id,
                        )
                          ? contact.default_project_id!
                          : 0
                      }
                      onChange={async (e) => {
                        const d = await action({
                          action: "project",
                          projectId: Number(e.target.value),
                        });
                        if (d) onNotify(d.note);
                      }}
                    >
                      <option value={0}>
                        未指定（单项目自动归入，多项目待确认）
                      </option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {projects.length > 1 &&
                    !projects.some(
                      (p) => p.id === contact.default_project_id,
                    ) && (
                      <small>
                        该客户有多个进行中项目。请指定新消息项目，或在客户沟通记录逐条归类，系统不会猜测。
                      </small>
                    )}
                </div>
              )}
              <div className="wa-messages" ref={messageArea}>
                <div className="wa-history">
                  <button
                    className="v2-button"
                    disabled={busy}
                    onClick={async () => {
                      const d = await action({ action: "history" });
                      if (d) onNotify(d.note);
                    }}
                  >
                    请求更早的平台记录
                  </button>
                  {more && (
                    <button
                      className="v2-button"
                      onClick={async () => {
                        const value = jid,
                          d = await request(undefined, jid, messages[0]?.id);
                        if (selectedRef.current === value) {
                          setMessages([...d.messages, ...messages]);
                          setMore(d.hasMore);
                        }
                      }}
                    >
                      查看本地更早记录
                    </button>
                  )}
                  <small>
                    同步手机与网页端实际下发的消息。附件可下载（单件50MB以内）；旧媒体可能已过期。阅后即焚媒体不保存，暂不支持发送附件。
                  </small>
                </div>
                {messages.map((m) => (
                  <article
                    key={m.id}
                    className={`wa-bubble ${m.from_me ? "outbound" : ""}`}
                  >
                    <p>{m.body}</p>
                    {m.kind === "media" &&
                      (m.media_available ? (
                        <a
                          className="wa-media-link"
                          href={`/api/files/${m.id}?source=whatsapp&download=1`}
                        >
                          <Download size={15} />
                          {m.media_name || "下载附件"}
                          {m.media_size > 0 &&
                            ` · ${(m.media_size / 1024).toFixed(0)} KB`}
                        </a>
                      ) : (
                        <small>
                          此旧消息未保留下载信息，请请求平台历史或在手机保存原件。
                        </small>
                      ))}
                    {m.translation && (
                      <div className="wa-translation">
                        <small>中文翻译</small>
                        <p>{m.translation}</p>
                      </div>
                    )}
                    <footer>
                      <time>
                        {new Date(m.timestamp * 1000).toLocaleString("zh-CN")}
                      </time>
                      <span>{statuses[m.status] || m.status}</span>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void action({ action: "translate", messageId: m.id })
                        }
                      >
                        <Languages size={13} />
                        翻译
                      </button>
                    </footer>
                  </article>
                ))}
                {!messages.length && (
                  <p className="wa-placeholder">
                    暂无已下发的消息。请在手机打开此聊天并等待同步，或等待客户发来新消息。以前未保存的历史不能凭空恢复。
                  </p>
                )}
              </div>
              <div className="wa-composer">
                <textarea
                  aria-label="WhatsApp回复内容"
                  placeholder="输入回复，或先去客户 AI 助手准备内容。不会自动发送。"
                  value={draft}
                  maxLength={10000}
                  onChange={(e) => setDraft(e.target.value)}
                  disabled={busy}
                />
                <footer>
                  <select
                    aria-label="回复翻译目标语言"
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                  >
                    {[
                      "英语",
                      "阿拉伯语",
                      "西班牙语",
                      "俄语",
                      "法语",
                      "葡萄牙语",
                      "简体中文",
                    ].map((l) => (
                      <option key={l}>{l}</option>
                    ))}
                  </select>
                  <button
                    className="v2-button"
                    disabled={busy || !draft.trim()}
                    onClick={async () => {
                      const value = jid,
                        d = await action({
                          action: "translateDraft",
                          body: draft,
                          language,
                        });
                      if (d && selectedRef.current === value) setDraft(d.text);
                    }}
                  >
                    <Languages size={14} />
                    翻译草稿
                  </button>
                  <button
                    className="v2-button primary"
                    disabled={busy || !draft.trim() || !connected}
                    onClick={() => setConfirm(true)}
                  >
                    <Send size={14} />
                    确认后发送
                  </button>
                </footer>
              </div>
            </>
          )}
        </main>
      </div>
      {confirm && contact && (
        <div className="v2-dialog-backdrop">
          <section className="v2-dialog">
            <h3>确认发送 WhatsApp</h3>
            <p>收件人：{contact.name || contact.jid}</p>
            <p className="wa-send-preview">{draft}</p>
            <small>此操作会真实发送消息。请核对收件人、报价和内容。</small>
            <div className="folder-actions">
              <button
                className="v2-button"
                disabled={busy}
                onClick={() => setConfirm(false)}
              >
                返回修改
              </button>
              <button
                className="v2-button primary"
                disabled={busy}
                onClick={async () => {
                  const body = draft,
                    value = jid;
                  let pending = sendRef.current;
                  if (!pending || pending.jid !== jid || pending.body !== body)
                    pending = sendRef.current = {
                      jid,
                      body,
                      id: crypto.randomUUID(),
                    };
                  const d = await action({
                    action: "send",
                    body,
                    requestId: pending.id,
                    confirmed: true,
                  });
                  setConfirm(false);
                  if (d) {
                    if (
                      ["accepted", "delivered", "read"].includes(
                        d.result.status,
                      )
                    ) {
                      if (selectedRef.current === value) setDraft("");
                      onNotify("消息已提交，送达及已读状态以平台回执为准");
                    } else
                      onNotify(
                        d.result.error ||
                          "发送结果待确认，请检查手机，不要重复发送",
                      );
                  }
                }}
              >
                {busy ? "正在提交…" : "发送这条消息"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
