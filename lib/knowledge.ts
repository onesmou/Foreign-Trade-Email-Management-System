import "server-only";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { dataDirectory, getDb } from "./db";

const plainExtensions = new Set([".txt", ".md", ".mdx", ".csv", ".tsv", ".json", ".jsonl", ".xml", ".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".py", ".java", ".go", ".rs", ".php", ".rb", ".vue", ".svelte", ".sql", ".yaml", ".yml", ".toml", ".ini", ".conf", ".log"]);
const ignoredParts = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".cache", "vendor", "target", "backup", "backups"]);
const secretNames = /(^|\/)(\.env(?:\.|$)|id_rsa|id_ed25519|credentials|secrets?|.*\.(pem|key|p12|pfx))$/i;

export type KnowledgeResult = { id: number; name: string; sourcePath: string; category: string; summary: string; chunks: number; warning?: string };

export async function ingestUpload(name: string, buffer: Buffer, mime: string, userId: number): Promise<KnowledgeResult[]> {
  if (buffer.length > 25 * 1024 * 1024) throw new Error(`${name} 超过单文件 25MB 限制`);
  if (isIgnored(name)) throw new Error(`${name} 属于被过滤的依赖、缓存或密钥文件`);
  const ext = path.extname(name).toLowerCase();
  if (ext === ".zip") return ingestZip(name, buffer, userId);
  const storedName = `${randomUUID()}${ext}`;
  writeFileSync(path.join(dataDirectory(), "uploads", storedName), buffer);
  const text = await extractText(name, buffer);
  return [saveKnowledge({ originalName: path.basename(name), sourcePath: name, storedName, mime, size: buffer.length, text, userId })];
}

async function ingestZip(zipName: string, buffer: Buffer, userId: number) {
  const archive = new AdmZip(buffer);
  const entries = archive.getEntries().filter((entry) => !entry.isDirectory && !isIgnored(entry.entryName));
  if (entries.length > 1200) throw new Error("压缩包有效文件超过1200个，请先清理依赖和构建目录");
  let total = 0;
  const results: KnowledgeResult[] = [];
  for (const entry of entries) {
    if (!isSupported(entry.entryName)) continue;
    if (entry.header.size > 8 * 1024 * 1024) continue;
    total += entry.header.size;
    if (total > 60 * 1024 * 1024) break;
    try {
      const data = entry.getData();
      const text = await extractText(entry.entryName, data);
      if (text.trim()) results.push(saveKnowledge({ originalName: path.basename(entry.entryName), sourcePath: `${zipName}/${entry.entryName}`, storedName: "", mime: mimeFromName(entry.entryName), size: data.length, text, userId }));
    } catch { /* one unreadable file should not block the project import */ }
  }
  if (!results.length) throw new Error("压缩包中没有可读取的资料文件");
  return results;
}

async function extractText(name: string, buffer: Buffer) {
  const ext = path.extname(name).toLowerCase();
  if (plainExtensions.has(ext)) {
    const text = buffer.toString("utf8");
    return [".html", ".htm"].includes(ext) ? stripHtml(text) : text;
  }
  if (ext === ".pdf") return (await pdfParse(buffer)).text;
  if (ext === ".docx") return (await mammoth.extractRawText({ buffer })).value;
  if (ext === ".xlsx") return extractXlsxText(buffer);
  if (ext === ".xls") throw new Error("旧版 .xls 请另存为 .xlsx 后上传");
  throw new Error(`暂不支持 ${ext || "未知"} 文件；可转换为 PDF、Word、Excel 或文本后上传`);
}

function saveKnowledge(input: { originalName: string; sourcePath: string; storedName: string; mime: string; size: number; text: string; userId: number }) {
  const text = normalizeText(input.text).slice(0, 2_000_000);
  if (text.length < 10) throw new Error(`${input.originalName} 没有提取到有效文字`);
  const chunks = splitIntoChunks(text);
  const category = classifyLocally(input.sourcePath, text);
  const summary = summarizeLocally(text);
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const info = db.prepare(`INSERT INTO knowledge_files
      (original_name,source_path,stored_name,mime_type,size_bytes,category,summary,status,chunk_count,uploaded_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(input.originalName, input.sourcePath, input.storedName, input.mime, input.size, category, summary, "ready", chunks.length, input.userId);
    const fileId = Number(info.lastInsertRowid);
    const insert = db.prepare("INSERT INTO knowledge_chunks (file_id,chunk_index,content,keywords) VALUES (?,?,?,?)");
    chunks.forEach((chunk, index) => insert.run(fileId, index, chunk, tokensFor(chunk).slice(0, 60).join(" ")));
    db.exec("COMMIT");
    return { id: fileId, name: input.originalName, sourcePath: input.sourcePath, category, summary, chunks: chunks.length };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function listKnowledge() {
  return getDb().prepare(`SELECT k.*,u.name AS uploader FROM knowledge_files k LEFT JOIN users u ON u.id=k.uploaded_by
    ORDER BY datetime(k.created_at) DESC,k.id DESC`).all();
}

export function deleteKnowledge(id: number) {
  const row = getDb().prepare("SELECT stored_name FROM knowledge_files WHERE id=?").get(id) as { stored_name?: string } | undefined;
  getDb().prepare("DELETE FROM knowledge_files WHERE id=?").run(id);
  return row?.stored_name || "";
}

export function updateKnowledgeCategory(id: number, category: string, summary?: string) {
  getDb().prepare("UPDATE knowledge_files SET category=?,summary=COALESCE(NULLIF(?,''),summary) WHERE id=?").run(category.slice(0, 40), summary?.slice(0, 500) || "", id);
}

export function retrieveKnowledge(query: string, limit = 8) {
  const queryTokens = tokensFor(query);
  const rows = getDb().prepare(`SELECT c.id,c.file_id,c.content,c.keywords,f.original_name,f.source_path,f.category
    FROM knowledge_chunks c JOIN knowledge_files f ON f.id=c.file_id WHERE f.status='ready' ORDER BY f.id DESC LIMIT 5000`).all() as Array<Record<string, string | number>>;
  const scored = rows.map((row) => {
    const haystack = `${row.keywords} ${row.content}`.toLowerCase();
    let score = 0;
    for (const token of queryTokens) {
      const escaped = token.toLowerCase();
      if (haystack.includes(escaped)) score += escaped.length >= 5 ? 4 : 2;
      if (String(row.original_name).toLowerCase().includes(escaped)) score += 5;
    }
    if (/产品|product|catalog|spec/i.test(query) && /产品资料|技术资料/.test(String(row.category))) score += 3;
    return { ...row, score };
  }).filter((row) => row.score > 0).sort((a, b) => b.score - a.score);
  const chosen: Array<Record<string, string | number> & { score: number }> = (scored.length ? scored : rows.slice(0, 3).map((row) => ({ ...row, score: 0 }))).slice(0, limit);
  return chosen.map((row) => ({ fileId: Number(row.file_id), name: String(row.original_name), sourcePath: String(row.source_path), category: String(row.category), content: String(row.content).slice(0, 3500), score: Number(row.score) }));
}

export function classifyLocally(name: string, text: string) {
  const sample = `${name} ${text.slice(0, 5000)}`.toLowerCase();
  if (/product|catalog|产品|型号|specification|参数|康复|trainer|therapy/.test(sample)) return "产品资料";
  if (/certificate|iso|ce |资质|证书|营业执照|认证/.test(sample)) return "公司资质";
  if (/quotation|price|报价|价格|moq|付款|payment/.test(sample)) return "报价与商务政策";
  if (/whatsapp|follow.?up|话术|reply|回复|客户沟通/.test(sample)) return "销售话术";
  if (/readme|package\.json|source|api|代码|项目|deployment|部署/.test(sample)) return "Agent / 项目文件";
  if (/company|about us|公司介绍|brand|品牌/.test(sample)) return "公司介绍";
  return "其他资料";
}

function isIgnored(name: string) {
  const normalized = name.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.some((part) => ignoredParts.has(part.toLowerCase())) || secretNames.test(normalized) || normalized.includes("../");
}

function isSupported(name: string) {
  const ext = path.extname(name).toLowerCase();
  return plainExtensions.has(ext) || [".pdf", ".docx", ".xlsx", ".xls"].includes(ext);
}

function splitIntoChunks(text: string) {
  const chunks: string[] = [];
  const size = 3200; const overlap = 300;
  for (let start = 0; start < text.length; start += size - overlap) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const boundary = Math.max(text.lastIndexOf("\n", end), text.lastIndexOf("。", end), text.lastIndexOf(". ", end));
      if (boundary > start + 1800) end = boundary + 1;
    }
    chunks.push(text.slice(start, end).trim());
    if (end >= text.length) break;
  }
  return chunks.filter(Boolean);
}

function tokensFor(text: string) {
  const ascii = (text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || []).filter((token) => !["the", "and", "for", "with", "from", "this", "that"].includes(token));
  const chineseRuns = text.match(/[\u4e00-\u9fff]{2,}/g) || [];
  const chinese: string[] = [];
  for (const run of chineseRuns) for (let i = 0; i < run.length - 1; i++) chinese.push(run.slice(i, i + Math.min(4, run.length - i)));
  return [...new Set([...ascii, ...chinese])].slice(0, 160);
}

function summarizeLocally(text: string) { return text.replace(/\s+/g, " ").trim().slice(0, 220); }
function normalizeText(text: string) { return text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim(); }
function stripHtml(html: string) { return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " "); }
function mimeFromName(name: string) { const ext = path.extname(name).toLowerCase(); return ext === ".pdf" ? "application/pdf" : ext === ".docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : ext === ".xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/plain"; }

function extractXlsxText(buffer: Buffer) {
  const zip = new AdmZip(buffer);
  const entries = new Map(zip.getEntries().filter((entry) => !entry.isDirectory).map((entry) => [entry.entryName, entry]));
  const sharedXml = entries.get("xl/sharedStrings.xml")?.getData().toString("utf8") || "";
  const sharedStrings = [...sharedXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map((match) => decodeXml([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => part[1]).join("")));
  const workbookXml = entries.get("xl/workbook.xml")?.getData().toString("utf8") || "";
  const names = [...workbookXml.matchAll(/<sheet[^>]*name="([^"]+)"/g)].map((match) => decodeXml(match[1]));
  const sheets = [...entries.entries()].filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort(([a],[b]) => a.localeCompare(b, undefined, { numeric: true }));
  return sheets.map(([, entry], index) => {
    const xml = entry.getData().toString("utf8");
    const rows = [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((row) => [...row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map((cell) => {
      const type = /\bt="([^"]+)"/.exec(cell[1])?.[1];
      const value = /<v>([\s\S]*?)<\/v>/.exec(cell[2])?.[1] || /<t[^>]*>([\s\S]*?)<\/t>/.exec(cell[2])?.[1] || "";
      return type === "s" ? (sharedStrings[Number(value)] || "") : decodeXml(value);
    }).join("\t")).join("\n");
    return `# ${names[index] || `Sheet ${index + 1}`}\n${rows}`;
  }).join("\n\n");
}

function decodeXml(value: string) { return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"); }
