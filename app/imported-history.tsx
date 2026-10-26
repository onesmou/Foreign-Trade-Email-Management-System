"use client";
import { useState, useEffect, useEffectEvent } from "react";
import Markdown from "react-markdown";
import { historicalLink, historicalMessage } from "../lib/codex-history-format";
type Import = {
  id: string;
  source_title: string;
  thread_id: string;
  coverage: string;
  imported_at: string;
};
type Item = {
  source_item_id: string;
  role: string;
  phase: string;
  body: string;
  recorded_at: string;
};
type File = {
  id: number;
  original_name: string;
  original_path: string;
  role: string;
  scope: string;
  can_send: number;
  is_current: number;
};
type Data = {
  imports: Import[];
  importId: string;
  items: Item[];
  files: File[];
  total: number;
  hasMore: boolean;
  note: string;
};
export default function ImportedHistory({
  customerId,
  projectId,
  onNotify,
}: {
  customerId: number;
  projectId: number;
  onNotify: (s: string) => void;
}) {
  const [data, setData] = useState<Data | null>(null),
    [commentary, setCommentary] = useState(false),
    [query, setQuery] = useState("");
  async function load(offset = 0, id = "") {
    try {
      const r = await fetch(
          `/api/imported-conversations?customerId=${customerId}&projectId=${projectId}&offset=${offset}${id ? `&id=${encodeURIComponent(id)}` : ""}`,
          { cache: "no-store" },
        ),
        d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData((previous) =>
        offset && previous
          ? { ...d, items: [...previous.items, ...d.items] }
          : d,
      );
    } catch (e) {
      onNotify((e as Error).message);
    }
  }
  const onLoad = useEffectEvent(load);
  useEffect(() => {
    const t = setTimeout(() => void onLoad(), 0);
    return () => clearTimeout(t);
  }, [customerId, projectId]);
  if (!data) return <div className="v2-small-empty">正在读取迁移记录…</div>;
  if (!data.imports.length)
    return <div className="v2-small-empty">此客户尚未迁入 Codex 历史。</div>;
  const current = data.imports.find((i) => i.id === data.importId),
    items = data.items.filter(
      (i) =>
        (commentary || i.phase !== "commentary") &&
        i.body.toLowerCase().includes(query.toLowerCase()),
    );
  return (
    <section className="imported-history">
      <header>
        <h3>Codex 历史对话</h3>
        <p>{data.note}</p>
        <select
          aria-label="选择历史对话"
          value={data.importId}
          onChange={(e) => void load(0, e.target.value)}
        >
          {data.imports.map((i) => (
            <option key={i.id} value={i.id}>
              {i.source_title}
            </option>
          ))}
        </select>
        <small>
          已迁入 {data.total} 条可见消息 · 原始对话保留 · 来源编号{" "}
          {current?.thread_id}
        </small>
        <label>
          <input
            type="checkbox"
            checked={commentary}
            onChange={(e) => setCommentary(e.target.checked)}
          />
          同时显示 AI 过程说明
        </label>
        <input
          aria-label="搜索Codex历史"
          placeholder="在已加载的历史中搜索…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </header>
      {items.map((i) => (
        <article key={i.source_item_id} className={`imported-chat ${i.role}`}>
          <header>
            <strong>
              {i.role === "user" ? "你当时的说明" : "Codex 当时的回复"}
              {i.phase === "commentary" ? " · 过程说明" : ""}
            </strong>
            <small>
              {new Date(i.recorded_at).toLocaleString("zh-CN")} · 对话轮次时间
            </small>
          </header>
          <Markdown
            urlTransform={(url) => historicalLink(url, data.files)}
            components={{
              a: ({ href, children }) =>
                href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                ) : (
                  <span>
                    {children}
                    <small>〔历史本机路径，请从迁入文件列表打开〕</small>
                  </span>
                ),
              img: () => <span>〔历史图片请从迁入文件列表打开〕</span>,
            }}
          >
            {historicalMessage(i.body, i.role).text}
          </Markdown>
          {historicalMessage(i.body, i.role).metadata && (
            <details>
              <summary>查看原始附件说明</summary>
              <pre>{historicalMessage(i.body, i.role).metadata}</pre>
            </details>
          )}
        </article>
      ))}
      {data.hasMore && (
        <button
          className="v2-button"
          onClick={() => void load(data.items.length, data.importId)}
        >
          继续加载历史内容
        </button>
      )}
      <details className="imported-file-list">
        <summary>
          迁入原文件 {data.files.length} 份 · 可发附件{" "}
          {data.files.filter((f) => f.can_send).length} 份
        </summary>
        <p>内部工作资料、历史草稿和客户原始附件不自动成为客户可发报价。</p>
        {data.files.map((f) => (
          <div key={f.id}>
            <a href={`/api/files/${f.id}?download=1`}>{f.original_path}</a>
            <small>
              {f.scope === "internal"
                ? "仅管理员 · 内部资料"
                : f.role === "draft"
                  ? "历史草稿 · 非原始发件"
                  : f.role === "incoming"
                    ? "客户原始资料"
                    : "客户档案"}
              {!f.is_current ? " · 已被后续版本替换" : ""}
            </small>
          </div>
        ))}
      </details>
    </section>
  );
}
