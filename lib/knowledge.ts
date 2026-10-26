import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { dataDirectory, getDb } from "./db";
import { fileAccess, type Row } from "./crm";
import type { SessionUser } from "./auth";
import { ensureFolder, folderPath } from "./folders";
import { organizeFile } from "./organize";

const plainExtensions = new Set([
  ".txt",
  ".md",
  ".mdx",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".php",
  ".rb",
  ".vue",
  ".svelte",
  ".sql",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".log",
]);
const ignoredParts = new Set([
  "data",
  ".openai",
  ".codex",
  ".aws",
  ".ssh",
  ".wrangler",
  ".wwebjs_auth",
  ".wwebjs_cache",
  "auth_info_baileys",
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".cache",
  "vendor",
  "target",
  "backup",
  "backups",
]);
const secretNames =
  /(^|\/)(\.env(?:\.|$)|id_rsa|id_ed25519|credentials|secrets?|.*\.(pem|key|p12|pfx))$/i;

export type KnowledgeResult = {
  id: number;
  name: string;
  sourcePath: string;
  category: string;
  summary: string;
  chunks: number;
  warning?: string;
};

export type ImportScope = {
  scope: "company" | "internal" | "customer";
  customerId?: number;
  folderId?: number;
  autoOrganize?: boolean;
};
export async function ingestUpload(
  name: string,
  buffer: Buffer,
  mime: string,
  userId: number,
  scope: ImportScope = { scope: "company" },
): Promise<KnowledgeResult[]> {
  if (buffer.length > 25 * 1024 * 1024)
    throw new Error(`${name} 超过单文件 25MB 限制`);
  if (isIgnored(name))
    throw new Error(`${name} 属于被过滤的依赖、缓存或密钥文件`);
  const ext = path.extname(name).toLowerCase();
  if (ext === ".zip") return ingestZip(name, buffer, userId, scope);
  if (!isSupported(name))
    throw new Error(
      "不支持此文件类型，请转换为 PDF、DOCX、XLSX、文本或常见图片",
    );
  return [queueFile(name, buffer, mime, userId, scope)];
}

async function ingestZip(
  zipName: string,
  buffer: Buffer,
  userId: number,
  scope: ImportScope,
) {
  const archive = new AdmZip(buffer);
  const entries = archive
    .getEntries()
    .filter((entry) => !entry.isDirectory && !isIgnored(entry.entryName));
  if (entries.length > 1200)
    throw new Error("压缩包有效文件超过1200个，请先清理依赖和构建目录");
  const total = entries.reduce((n, e) => n + e.header.size, 0);
  if (total > 60 * 1024 * 1024)
    throw new Error("压缩包展开后超过60MB，请拆分导入");
  const results: KnowledgeResult[] = [];
  for (const entry of entries) {
    if (!isSupported(entry.entryName)) continue;
    if (entry.header.size > 25 * 1024 * 1024)
      throw new Error(`${entry.entryName} 超过25MB，请拆分后导入`);
    results.push(
      queueFile(
        `${zipName}/${entry.entryName}`,
        entry.getData(),
        mimeFromName(entry.entryName),
        userId,
        scope,
      ),
    );
  }
  if (!results.length) throw new Error("压缩包中没有可读取的资料文件");
  return results;
}

function queueFile(
  name: string,
  buffer: Buffer,
  mime: string,
  userId: number,
  scope: ImportScope,
): KnowledgeResult {
  if (
    plainExtensions.has(path.extname(name).toLowerCase()) &&
    /(?:sk-[a-zA-Z0-9_-]{24,}|AKIA[A-Z0-9]{16}|(?:API[_-]?KEY|ACCESS[_-]?TOKEN|PRIVATE[_-]?KEY)\s*[=:]\s*["']?[a-zA-Z0-9_-]{24,})/.test(
      buffer.toString("utf8"),
    )
  )
    throw new Error("检测到疑似密钥，未导入，请移除敏感内容后重试");
  if (
    scope.scope === "company" &&
    /(?:supplier|markup|internal|working[-_]?files|customer[-_]?inquiries|customer-ready-attachments|(?:^|[\\/])quotations[\\/]|供应商|内部|底价|成本|客户档案|客户资料)/i.test(
      name,
    )
  )
    scope = { scope: "internal", autoOrganize: scope.autoOrganize };
  const db = getDb();
  const hash = createHash("sha256").update(buffer).digest("hex");
  const existing = db
    .prepare(
      "SELECT * FROM knowledge_files WHERE content_hash=? AND scope=? AND COALESCE(customer_id,0)=? AND is_current=1",
    )
    .get(hash, scope.scope, scope.customerId || 0) as Row | undefined;
  if (existing)
    return {
      id: Number(existing.id),
      name: String(existing.original_name),
      sourcePath: String(existing.source_path),
      category: String(existing.category),
      summary: String(existing.summary),
      chunks: Number(existing.chunk_count),
      warning: "内容相同，已复用原文件",
    };
  const previous = db
    .prepare(
      "SELECT MAX(version) AS version FROM knowledge_files WHERE source_path=? AND scope=? AND COALESCE(customer_id,0)=?",
    )
    .get(name, scope.scope, scope.customerId || 0) as {
    version: number | null;
  };
  const storedName = `${randomUUID()}${path.extname(name).toLowerCase()}`;
  writeFileSync(path.join(dataDirectory(), "uploads", storedName), buffer);
  const category = classifyLocally(name, "");
  let folderId = scope.folderId || null;
  if (!folderId) {
    folderId = ensureFolder(
      scope.autoOrganize ? "待整理" : "手动导入",
      null,
      scope,
      userId,
    );
    // Manual folder import retains the original hierarchy. AI import uses contents instead.
    if (!scope.autoOrganize)
      for (const part of name
        .replace(/\\/g, "/")
        .split("/")
        .slice(0, -1)
        .slice(0, 15))
        if (part && part !== ".")
          folderId = ensureFolder(part, folderId, scope, userId);
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "UPDATE knowledge_files SET is_current=0 WHERE source_path=? AND scope=? AND COALESCE(customer_id,0)=?",
    ).run(name, scope.scope, scope.customerId || 0);
    const id = Number(
      db
        .prepare(
          `INSERT INTO knowledge_files(original_name,source_path,stored_name,mime_type,size_bytes,category,summary,status,uploaded_by,scope,customer_id,content_hash,version) VALUES(?,?,?,?,?,?,?,'queued',?,?,?,?,?)`,
        )
        .run(
          path.basename(name),
          name,
          storedName,
          mime || mimeFromName(name),
          buffer.length,
          category,
          "等待后台解析",
          userId,
          scope.scope,
          scope.customerId || null,
          hash,
          (previous.version || 0) + 1,
        ).lastInsertRowid,
    );
    db.prepare(
      "UPDATE knowledge_files SET folder_id=?,auto_organize=?,organize_status=?,manual_folder=? WHERE id=?",
    ).run(
      folderId,
      scope.autoOrganize ? 1 : 0,
      scope.autoOrganize ? "等待识别" : "手动归档",
      scope.autoOrganize ? 0 : 1,
      id,
    );
    db.exec("COMMIT");
    scheduleProcessing();
    return {
      id,
      name: path.basename(name),
      sourcePath: name,
      category,
      summary: "等待后台解析",
      chunks: 0,
    };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
declare global {
  var __crmIndexing: boolean | undefined;
}
export function scheduleProcessing() {
  if (global.__crmIndexing) return;
  global.__crmIndexing = true;
  setTimeout(
    () =>
      void processQueue().finally(() => {
        global.__crmIndexing = false;
      }),
    20,
  );
}
async function processQueue() {
  const db = getDb();
  db.prepare(
    "UPDATE knowledge_files SET status='queued' WHERE status='processing'",
  ).run();
  while (true) {
    const row = db
      .prepare(
        "SELECT * FROM knowledge_files WHERE status='queued' ORDER BY id LIMIT 1",
      )
      .get() as Row | undefined;
    if (!row) break;
    db.prepare(
      "UPDATE knowledge_files SET status='processing',error='' WHERE id=?",
    ).run(row.id);
    try {
      if (row.index_policy === "original_only")
        throw new Error(
          "此历史原件仅供查看，需求以人工核对的转录为准，未执行全文索引",
        );
      const image = /\.(png|jpg|jpeg|webp)$/i.test(String(row.original_name));
      const buffer = readFileSync(
        path.join(dataDirectory(), "uploads", String(row.stored_name)),
      );
      let text = "";
      if (!image)
        try {
          text = normalizeText(
            await extractText(String(row.original_name), buffer),
          ).slice(0, 2_000_000);
        } catch (e) {
          // Valid-looking PDFs unsupported by the local parser may still be readable by a file-capable visual model.
          if (
            !Number(row.auto_organize) ||
            Number(row.manual_folder) ||
            !String(row.original_name).toLowerCase().endsWith(".pdf") ||
            !buffer.subarray(0, 8).toString("ascii").startsWith("%PDF-")
          )
            throw e;
        }
      if (
        /(?:sk-[a-zA-Z0-9_-]{24,}|AKIA[A-Z0-9]{16}|(?:API[_-]?KEY|ACCESS[_-]?TOKEN|PRIVATE[_-]?KEY)\s*[=:]\s*["']?[a-zA-Z0-9_-]{24,})/.test(
          text,
        )
      ) {
        db.prepare(
          "UPDATE knowledge_files SET scope='internal',customer_id=NULL,folder_id=NULL,auto_organize=0,organize_status='识别失败',organize_reason='检测到疑似密钥，未发送到AI，请管理员检查原件' WHERE id=?",
        ).run(row.id);
        row.auto_organize = 0;
        throw new Error("检测到疑似密钥，未发送到AI，原件已隔离为内部资料");
      }
      const visual =
        image ||
        (/\.pdf$/i.test(String(row.original_name)) &&
          text.replace(/\s/g, "").length < 40);
      if (Number(row.auto_organize) && !Number(row.manual_folder)) {
        const organized = await organizeFile(row, text, buffer, visual);
        if (organized.text)
          text = `${text}\nAI内容识别（请以原文件为准）：\n${organized.text}`;
        if (organized.metadata)
          text += `\nAI归类信息（待核对）：\n${organized.metadata}`;
      }
      if (text.length < 10) {
        if (Number(row.auto_organize))
          throw new Error(
            "尚未识别到有效正文，请查看AI整理原因；原件已保留，可更换识图模型后重试",
          );
        if (image) text = `图片文件：${row.source_path}。图片内容尚未识别。`;
        else throw new Error("未提取到有效文字，扫描件请开启AI识别后重试");
      }
      const chunks = splitIntoChunks(text);
      db.exec("BEGIN IMMEDIATE");
      try {
        db.prepare("DELETE FROM knowledge_chunks WHERE file_id=?").run(row.id);
        const insert = db.prepare(
          "INSERT INTO knowledge_chunks(file_id,chunk_index,content,keywords) VALUES(?,?,?,?)",
        );
        chunks.forEach((chunk, i) =>
          insert.run(row.id, i, chunk, tokensFor(chunk).join(" ")),
        );
        db.prepare(
          "UPDATE knowledge_files SET status='ready',summary=CASE WHEN organize_status IN ('已归类','待确认') THEN summary ELSE ? END,category=CASE WHEN organize_status IN ('已归类','待确认') THEN category ELSE ? END,chunk_count=?,error='' WHERE id=?",
        ).run(
          image
            ? "图片已保存；可按文件名/型号检索，内容尚未进行视觉识别"
            : summarizeLocally(text),
          image ? "产品图片" : classifyLocally(String(row.source_path), text),
          chunks.length,
          row.id,
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    } catch (e) {
      if (Number(row.auto_organize)) {
        const folder = ensureFolder(
          "待确认",
          null,
          {
            scope: String(row.scope),
            customerId: Number(row.customer_id) || undefined,
          },
          Number(row.uploaded_by),
        );
        db.prepare(
          "UPDATE knowledge_files SET organize_status='识别失败',organize_reason=CASE WHEN organize_reason='' THEN ? ELSE organize_reason END,folder_id=CASE WHEN manual_folder=0 THEN ? ELSE folder_id END WHERE id=?",
        ).run((e as Error).message, folder, row.id);
      }
      db.prepare(
        "UPDATE knowledge_files SET status='failed',error=?,summary=? WHERE id=?",
      ).run((e as Error).message, (e as Error).message, row.id);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function extractText(name: string, buffer: Buffer) {
  const ext = path.extname(name).toLowerCase();
  if (plainExtensions.has(ext)) {
    let text = buffer.toString("utf8");
    if (buffer[0] === 0xff && buffer[1] === 0xfe)
      text = buffer.subarray(2).toString("utf16le");
    else if (text.includes("\ufffd")) {
      try {
        const gb = new TextDecoder("gb18030", { fatal: true }).decode(buffer);
        if (!gb.includes("\ufffd")) text = gb;
      } catch {
        /* reject lossy text below */
      }
    }
    if ((text.match(/\ufffd/g) || []).length > Math.max(2, text.length * 0.01))
      throw new Error(
        "文档正文存在严重乱码，请另存为UTF-8；不会按乱码猜测归类",
      );
    return [".html", ".htm"].includes(ext) ? stripHtml(text) : text;
  }
  if (ext === ".pdf") return (await pdfParse(buffer)).text;
  if (ext === ".docx") {
    if (
      new AdmZip(buffer).getEntries().reduce((n, e) => n + e.header.size, 0) >
      60 * 1024 * 1024
    )
      throw new Error("Word 展开后超过60MB，请拆分文档");
    return (await mammoth.extractRawText({ buffer })).value;
  }
  if (ext === ".xlsx") return extractXlsxText(buffer);
  if (ext === ".xls") throw new Error("旧版 .xls 请另存为 .xlsx 后上传");
  throw new Error(
    `暂不支持 ${ext || "未知"} 文件；可转换为 PDF、Word、Excel 或文本后上传`,
  );
}

export function listKnowledge(user?: SessionUser): Row[] {
  scheduleProcessing();
  const rows = getDb()
    .prepare(
      `SELECT k.*,u.name AS uploader FROM knowledge_files k LEFT JOIN users u ON u.id=k.uploaded_by ORDER BY k.id DESC`,
    )
    .all() as Row[];
  return (user ? rows.filter((f) => fileAccess(user, f)) : rows).map((f) => ({
    ...f,
    folder_path: folderPath(Number(f.folder_id) || null),
  }));
}

export function deleteKnowledge(id: number) {
  const row = getDb()
    .prepare("SELECT stored_name FROM knowledge_files WHERE id=?")
    .get(id) as { stored_name?: string } | undefined;
  getDb().prepare("DELETE FROM knowledge_files WHERE id=?").run(id);
  return row?.stored_name || "";
}

export function updateKnowledgeCategory(
  id: number,
  category: string,
  summary?: string,
) {
  getDb()
    .prepare(
      "UPDATE knowledge_files SET category=?,summary=COALESCE(NULLIF(?,''),summary) WHERE id=?",
    )
    .run(category.slice(0, 40), summary?.slice(0, 500) || "", id);
}

export function retrieveKnowledge(
  query: string,
  limit = 8,
  user?: SessionUser,
  customerId?: number,
) {
  const queryTokens = tokensFor(query);
  const rows = (
    getDb()
      .prepare(
        `SELECT c.id,c.file_id,c.content,c.keywords,f.original_name,f.display_name,f.folder_id,f.auto_organize,f.manual_folder,f.organize_status,f.uploaded_by,f.can_send,f.source_path,f.category,f.scope,f.customer_id,f.stored_name,f.version
    FROM knowledge_chunks c JOIN knowledge_files f ON f.id=c.file_id WHERE f.status='ready' AND f.is_current=1 ORDER BY f.id DESC LIMIT 10000`,
      )
      .all() as Array<Record<string, string | number>>
  ).filter(
    (r) =>
      (!user || fileAccess(user, r)) &&
      (r.scope !== "customer" || Number(r.customer_id) === customerId),
  );
  const scored = rows
    .map((row) => {
      const haystack =
        `${row.source_path} ${row.display_name} ${folderPath(Number(row.folder_id) || null)} ${row.keywords} ${row.content}`.toLowerCase();
      let score = 0;
      for (const token of queryTokens) {
        const escaped = token.toLowerCase();
        if (haystack.includes(escaped)) score += escaped.length >= 5 ? 4 : 2;
        if (String(row.original_name).toLowerCase().includes(escaped))
          score += 5;
      }
      return { ...row, score } as Record<string, string | number> & {
        score: number;
      };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  const seen = new Set<number>();
  const chosen = scored
    .filter((r) => {
      if (seen.has(Number(r.file_id))) return false;
      seen.add(Number(r.file_id));
      return true;
    })
    .slice(0, limit);
  return chosen.map((row) => ({
    fileId: Number(row.file_id),
    name: String(row.original_name),
    sourcePath:
      folderPath(Number(row.folder_id) || null) || String(row.source_path),
    category: String(row.category),
    content: String(row.content).slice(0, 3500),
    score: Number(row.score),
    version: Number(row.version),
    canAttach:
      row.scope !== "internal" &&
      Number(row.can_send) !== 0 &&
      Boolean(row.stored_name) &&
      (!Number(row.auto_organize) ||
        Boolean(Number(row.manual_folder)) ||
        row.organize_status === "已归类"),
    url: `/api/files/${row.file_id}`,
  }));
}

export function classifyLocally(name: string, text: string) {
  const filename = path.basename(name).toLowerCase();
  if (/\.(png|jpe?g|webp)$/.test(filename)) return "产品图片";
  if (/quotation|price[-_ ]?list|报价|价格|商务|付款|payment/.test(filename))
    return "报价与商务政策";
  if (/certificate|资质|证书|认证|营业执照/.test(filename)) return "公司资质";
  if (/catalog|product|spec|产品|目录|参数|康复|步态|技术/.test(filename))
    return "产品资料";
  if (/company|profile|about|公司介绍|品牌/.test(filename)) return "公司介绍";
  const sample = `${name} ${text.slice(0, 5000)}`.toLowerCase();
  if (
    /product|catalog|产品|型号|specification|参数|康复|trainer|therapy/.test(
      sample,
    )
  )
    return "产品资料";
  if (/certificate|iso|ce |资质|证书|营业执照|认证/.test(sample))
    return "公司资质";
  if (/quotation|price|报价|价格|moq|付款|payment/.test(sample))
    return "报价与商务政策";
  if (/whatsapp|follow.?up|话术|reply|回复|客户沟通/.test(sample))
    return "销售话术";
  if (/readme|package\.json|source|api|代码|项目|deployment|部署/.test(sample))
    return "Agent / 项目文件";
  if (/company|about us|公司介绍|brand|品牌/.test(sample)) return "公司介绍";
  return "其他资料";
}

export function isIgnored(name: string) {
  const normalized = name.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return (
    parts.some(
      (part) =>
        ignoredParts.has(part.toLowerCase()) ||
        part === ".." ||
        part.startsWith(".env"),
    ) ||
    secretNames.test(normalized) ||
    /(^|\/)(token|api[-_]?keys?|auth_info|\.app-secret)(\.|\/|$)/i.test(
      normalized,
    )
  );
}

function isSupported(name: string) {
  const ext = path.extname(name).toLowerCase();
  return (
    plainExtensions.has(ext) ||
    [
      ".pdf",
      ".docx",
      ".xlsx",
      ".xls",
      ".png",
      ".jpg",
      ".jpeg",
      ".webp",
    ].includes(ext)
  );
}

function splitIntoChunks(text: string) {
  const chunks: string[] = [];
  const size = 3200;
  const overlap = 300;
  for (let start = 0; start < text.length; start += size - overlap) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const boundary = Math.max(
        text.lastIndexOf("\n", end),
        text.lastIndexOf("。", end),
        text.lastIndexOf(". ", end),
      );
      if (boundary > start + 1800) end = boundary + 1;
    }
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
  }
  return chunks.filter(Boolean);
}

function tokensFor(text: string) {
  const ascii = (
    text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || []
  ).filter(
    (token) =>
      !["the", "and", "for", "with", "from", "this", "that"].includes(token),
  );
  const chineseRuns = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const chinese: string[] = [];
  for (const run of chineseRuns)
    for (let i = 0; i < run.length - 1; i++)
      chinese.push(run.slice(i, i + Math.min(4, run.length - i)));
  return [...new Set([...ascii, ...chinese])].slice(0, 160);
}

function summarizeLocally(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 220);
}
function normalizeText(text: string) {
  return text
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}
function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
function mimeFromName(name: string) {
  const ext = path.extname(name).toLowerCase();
  const images: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
  };
  if (images[ext]) return images[ext];
  return ext === ".pdf"
    ? "application/pdf"
    : ext === ".docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : ext === ".xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/plain";
}

function extractXlsxText(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  if (
    zip.getEntries().reduce((n, e) => n + e.header.size, 0) >
    60 * 1024 * 1024
  )
    throw new Error("Excel 展开后超过60MB，请拆分表格");
  const entries = new Map(
    zip
      .getEntries()
      .filter((entry) => !entry.isDirectory)
      .map((entry) => [entry.entryName, entry]),
  );
  const sharedXml =
    entries.get("xl/sharedStrings.xml")?.getData().toString("utf8") || "";
  const sharedStrings = [
    ...sharedXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g),
  ].map((match) =>
    decodeXml(
      [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map((part) => part[1])
        .join(""),
    ),
  );
  const workbookXml =
    entries.get("xl/workbook.xml")?.getData().toString("utf8") || "";
  const names = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map(
    (match) => decodeXml(match[1]),
  );
  const sheets = [...entries.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  return sheets
    .map(([, entry], index) => {
      const xml = entry.getData().toString("utf8");
      const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)]
        .map((row) =>
          [...row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)]
            .map((cell) => {
              const type = /\bt="([^"]+)"/.exec(cell[1])?.[1];
              const value =
                /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1] ||
                /<t[^>]*>([\s\S]*?)<\/t>/.exec(cell[2])?.[1] ||
                "";
              return type === "s"
                ? sharedStrings[Number(value)] || ""
                : decodeXml(value);
            })
            .join("\t"),
        )
        .join("\n");
      return `# ${names[index] || `Sheet ${index + 1}`}\n${rows}`;
    })
    .join("\n\n");
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
