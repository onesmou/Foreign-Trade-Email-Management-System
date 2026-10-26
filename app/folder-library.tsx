"use client";
import { useState, useEffect, useEffectEvent, type ChangeEvent } from "react";
import {
  Folder,
  FolderOpen,
  Upload,
  Plus,
  ChevronRight,
  Search,
  RefreshCw,
  FileText,
  ArrowLeft,
} from "lucide-react";
type Row = { id: number; [key: string]: string | number | null };
type Source = {
  fileId: number;
  name: string;
  category: string;
  sourcePath: string;
  url: string;
  version: number;
  canAttach: boolean;
};
async function request(url: string, body?: unknown, method = "POST") {
  const r = await fetch(
    url,
    body === undefined
      ? { cache: "no-store" }
      : {
          method,
          ...(body instanceof FormData
            ? { body }
            : {
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              }),
        },
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "操作失败");
  return d;
}
export default function FolderLibrary({
  canWrite,
  isAdmin,
  onNotify,
  onPreview,
}: {
  canWrite: boolean;
  isAdmin: boolean;
  onNotify: (s: string) => void;
  onPreview: (s: Source) => void;
}) {
  const [files, setFiles] = useState<Row[]>([]),
    [folders, setFolders] = useState<Row[]>([]),
    [customers, setCustomers] = useState<Row[]>([]);
  const [scope, setScope] = useState("company"),
    [customerId, setCustomerId] = useState(0),
    [folderId, setFolderId] = useState(0),
    [query, setQuery] = useState("");
  const [auto, setAuto] = useState(true),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [review, setReview] = useState(false),
    [selected, setSelected] = useState<Row | null>(null),
    [destination, setDestination] = useState(0);
  async function load() {
    try {
      const d = await request("/api/knowledge");
      setFiles(d.files);
      setFolders(d.folders || []);
    } catch (e) {
      onNotify((e as Error).message);
    }
  }
  const onLoad = useEffectEvent(load);
  useEffect(() => {
    const first = setTimeout(() => void onLoad(), 0);
    void request("/api/customers").then((d) => setCustomers(d.customers || []));
    const t = setInterval(() => void onLoad(), 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  const same = (f: Row) =>
    f.scope === scope &&
    (scope !== "customer" || Number(f.customer_id) === customerId);
  const current = folders.find((f) => f.id === folderId),
    scoped = folders.filter(same),
    active = files.filter((f) => f.is_current && same(f));
  const trail: Row[] = [];
  let cursor = current;
  const seen = new Set<number>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    trail.unshift(cursor);
    cursor = folders.find((f) => f.id === Number(cursor?.parent_id));
  }
  const visible = active.filter((f) =>
    query
      ? `${f.original_name} ${f.display_name} ${f.summary} ${f.folder_path}`
          .toLowerCase()
          .includes(query.toLowerCase())
      : review
        ? ["待确认", "识别失败"].includes(String(f.organize_status))
        : Number(f.folder_id || 0) === folderId,
  );
  const children = scoped.filter((f) => Number(f.parent_id || 0) === folderId);
  async function action(url: string, body: unknown, method = "POST") {
    setBusy(true);
    try {
      await request(url, body, method);
      await load();
      return true;
    } catch (e) {
      onNotify((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget,
      chosen = Array.from(input.files || []);
    if (!chosen.length) return;
    if (scope === "customer" && !customerId) {
      onNotify("请先选择客户");
      input.value = "";
      return;
    }
    setBusy(true);
    let count = 0;
    const errors: string[] = [];
    for (const [i, file] of chosen.entries()) {
      setProgress(`${i + 1}/${chosen.length} · ${file.name}`);
      const f = new FormData();
      f.append("files", file);
      f.append("paths", file.webkitRelativePath || file.name);
      f.append("scope", scope);
      f.append("autoOrganize", String(auto));
      if (customerId) f.append("customerId", String(customerId));
      if (folderId && !auto) f.append("folderId", String(folderId));
      try {
        const d = await request("/api/knowledge", f);
        count += d.imported || 0;
        errors.push(...(d.errors || []));
      } catch (e) {
        errors.push(`${file.name}：${(e as Error).message}`);
      }
    }
    input.value = "";
    setBusy(false);
    setProgress("");
    await load();
    onNotify(
      `已接收${count}份资料${auto ? "，正在后台识别归档" : ""}${errors.length ? `；${errors.length}项未导入` : ""}`,
    );
    if (errors.length) window.alert(errors.slice(0, 12).join("\n"));
  }
  async function create() {
    const name = window.prompt(
      "新文件夹名称（例如：RehabIntl、KF-SET、产品图片）",
    );
    if (name?.trim())
      await action("/api/folders", {
        name,
        parentId: folderId || null,
        scope,
        customerId,
      });
  }
  return (
    <section className="v2-library folder-library">
      <div className="v2-card folder-intro">
        <div>
          <span className="v2-eyebrow">公司的资料，只需上传一次</span>
          <h2>像电脑文件夹一样管理，AI 按内容帮你整理</h2>
          <p>
            文件名乱也没关系：读正文、识别图片与扫描件，归入「公司 / 产品或型号
            / 资料类型」。原件始终保留。
          </p>
        </div>
        <div className="folder-actions">
          {canWrite && (
            <>
              <label className="v2-button primary">
                <Upload size={16} />
                上传文件 / ZIP
                <input
                  type="file"
                  multiple
                  hidden
                  disabled={busy}
                  onChange={upload}
                />
              </label>
              <label className="v2-button">
                <FolderOpen size={16} />
                上传整个文件夹
                <input
                  type="file"
                  multiple
                  hidden
                  disabled={busy}
                  {...({ webkitdirectory: "" } as object)}
                  onChange={upload}
                />
              </label>
            </>
          )}
        </div>
        <label className="folder-auto">
          <input
            type="checkbox"
            checked={auto}
            onChange={(e) => setAuto(e.target.checked)}
          />
          上传后自动 AI 识别与归档{" "}
          <span>
            会将资料内容发送给设置中的分析/识图服务，产生相应 API
            费用。关闭后仅本地解析，保留原文件夹结构。
          </span>
        </label>
        {progress && <p role="status">上传中：{progress}</p>}
      </div>
      <div className="folder-toolbar">
        <select
          aria-label="资料共享范围"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setFolderId(0);
            setSelected(null);
          }}
        >
          <option value="company">公司资料 · 团队可用</option>
          {isAdmin && <option value="internal">内部资料 · 仅管理员</option>}
          <option value="customer">客户专属资料</option>
        </select>
        {scope === "customer" && (
          <select
            aria-label="资料所属客户"
            value={customerId}
            onChange={(e) => {
              setCustomerId(Number(e.target.value));
              setFolderId(0);
            }}
          >
            <option value={0}>请选择客户</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.company}
              </option>
            ))}
          </select>
        )}
        <label className="v2-search">
          <Search size={16} />
          <input
            placeholder="在当前范围搜索文件、型号、内容摘要…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className={`v2-button ${review ? "primary" : ""}`}
          onClick={() => setReview(!review)}
        >
          待确认{" "}
          {
            active.filter((f) =>
              ["待确认", "识别失败"].includes(String(f.organize_status)),
            ).length
          }
        </button>
        <button
          className="v2-button"
          onClick={() => void load()}
          aria-label="刷新资料"
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <div className="folder-explorer v2-card">
        <aside>
          <button
            className={!folderId ? "active" : ""}
            onClick={() => {
              setFolderId(0);
              setReview(false);
              setQuery("");
            }}
          >
            <FolderOpen size={16} />
            全部文件夹
          </button>
          {scoped
            .filter((f) => !f.parent_id)
            .map((f) => (
              <button
                key={f.id}
                className={folderId === f.id ? "active" : ""}
                onClick={() => {
                  setFolderId(f.id);
                  setReview(false);
                  setQuery("");
                }}
              >
                <Folder size={16} />
                {f.name}
              </button>
            ))}
          <small>
            内部资料不会作为客户附件提供。客户专属资料仅在该客户下检索。
          </small>
        </aside>
        <main>
          <header className="folder-breadcrumb">
            <button
              onClick={() => {
                setFolderId(0);
                setReview(false);
                setQuery("");
              }}
            >
              资料库
            </button>
            {trail.map((f) => (
              <span key={f.id}>
                <ChevronRight size={13} />
                <button onClick={() => setFolderId(f.id)}>{f.name}</button>
              </span>
            ))}
            {canWrite && (
              <button
                className="v2-button"
                onClick={create}
                disabled={busy || (scope === "customer" && !customerId)}
              >
                <Plus size={15} />
                新建文件夹
              </button>
            )}
          </header>
          {!query && !review && (
            <div className="folder-grid">
              {folderId > 0 && (
                <button
                  className="folder-tile"
                  onClick={() => setFolderId(Number(current?.parent_id) || 0)}
                >
                  <ArrowLeft />
                  返回上一级
                </button>
              )}
              {children.map((f) => (
                <div className="folder-tile" key={f.id}>
                  <button
                    className="folder-open"
                    onClick={() => setFolderId(f.id)}
                  >
                    <Folder size={31} />
                    <strong>{f.name}</strong>
                  </button>
                  {canWrite && (
                    <button
                      className="folder-rename"
                      onClick={async () => {
                        const name = window.prompt(
                          "重命名文件夹",
                          String(f.name),
                        );
                        if (name)
                          await action(
                            "/api/folders",
                            { id: f.id, name, parentId: f.parent_id },
                            "PATCH",
                          );
                      }}
                    >
                      重命名
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="folder-count">
            {query
              ? "搜索结果"
              : review
                ? "请检查这些资料的识别结果"
                : "当前文件夹"}{" "}
            · {visible.length}份文件
            {active.some((f) =>
              ["queued", "processing"].includes(String(f.status)),
            )
              ? " · 后台处理中，自动刷新"
              : ""}
          </p>
          <div className="folder-file-list">
            {visible.map((f) => (
              <article className="folder-file" key={f.id}>
                <FileText size={23} />
                <div>
                  <button
                    className="folder-file-title"
                    onClick={() =>
                      onPreview({
                        fileId: f.id,
                        name: String(f.original_name),
                        category: String(f.category),
                        sourcePath: String(f.folder_path || f.source_path),
                        url: `/api/files/${f.id}`,
                        version: Number(f.version),
                        canAttach:
                          f.scope !== "internal" && Number(f.can_send) !== 0,
                      })
                    }
                  >
                    {f.display_name || f.original_name}
                  </button>
                  <small>
                    原文件：{f.original_name} · v{f.version} ·{" "}
                    {Math.ceil(Number(f.size_bytes) / 1024)}KB
                  </small>
                  <p>{f.summary}</p>
                  <small>
                    {f.folder_path || "尚未归档"} ·{" "}
                    <strong>{f.organize_status}</strong>
                    {Number(f.organize_confidence) > 0
                      ? ` · 置信度${Math.round(Number(f.organize_confidence) * 100)}%`
                      : ""}
                  </small>
                  {(f.organize_reason || f.error) && (
                    <details>
                      <summary>查看归类依据 / 失败原因</summary>
                      <p>{f.organize_reason || f.error}</p>
                      {f.organize_provider && (
                        <small>使用模型：{f.organize_provider}</small>
                      )}
                    </details>
                  )}
                </div>
                <div className="folder-file-actions">
                  <a
                    className="v2-button"
                    href={`/api/files/${f.id}?download=1`}
                  >
                    原件
                  </a>
                  {canWrite && (
                    <>
                      <button
                        className="v2-button"
                        disabled={
                          busy ||
                          ["queued", "processing"].includes(String(f.status))
                        }
                        onClick={() =>
                          void action(
                            "/api/library",
                            { id: f.id, retry: true, organize: true },
                            "PATCH",
                          )
                        }
                      >
                        重新识别
                      </button>
                      <button
                        className="v2-button"
                        onClick={() => {
                          setSelected(f);
                          setDestination(Number(f.folder_id) || 0);
                        }}
                      >
                        移动
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
            {!visible.length && !children.length && (
              <div className="v2-empty">
                <FolderOpen />
                <h3>这里还没有资料</h3>
                <p>
                  上传文件或文件夹后，会在此显示。AI
                  不确定的资料会进入“待确认”。
                </p>
              </div>
            )}
          </div>
        </main>
      </div>
      {selected && (
        <div className="v2-dialog-backdrop">
          <section className="v2-dialog">
            <h3>移动资料</h3>
            <p>{selected.original_name}</p>
            <select
              aria-label="目标文件夹"
              value={destination}
              onChange={(e) => setDestination(Number(e.target.value))}
            >
              <option value={0}>请选择目标文件夹</option>
              {folders
                .filter(
                  (f) =>
                    f.scope === selected.scope &&
                    Number(f.customer_id || 0) ===
                      Number(selected.customer_id || 0),
                )
                .map((f) => (
                  <option value={f.id} key={f.id}>
                    {f.path}
                  </option>
                ))}
            </select>
            <p>手动归档后，后台 AI 不会再覆盖此位置。</p>
            <div className="folder-actions">
              <button className="v2-button" onClick={() => setSelected(null)}>
                取消
              </button>
              <button
                className="v2-button primary"
                disabled={!destination || busy}
                onClick={async () => {
                  if (
                    await action(
                      "/api/folders",
                      { fileId: selected.id, folderId: destination },
                      "PATCH",
                    )
                  )
                    setSelected(null);
                }}
              >
                确认移动
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
