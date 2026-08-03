import AdmZip from "adm-zip";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const MAGIC = Buffer.from("RICRMBAK1", "ascii");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES;
const BACKUP_EXTENSION = ".ricrmbak";
const REQUIRED_TABLES = ["users", "customers", "inquiries", "company_profile", "ai_providers", "knowledge_files"];

export type BackupInfo = { id: string; filename: string; size: number; createdAt: string; sha256?: string };

export async function createEncryptedBackup(input: { dataDir: string; passphrase: string; envContents?: string; retentionDays?: number; retentionCount?: number }) {
  validatePassphrase(input.passphrase);
  const dataDir = path.resolve(/*turbopackIgnore: true*/ input.dataDir);
  const databasePath = path.join(dataDir, "rehabintl-crm.sqlite");
  if (!existsSync(databasePath)) throw new Error("数据库尚未创建，无法生成备份");
  const backupDir = path.join(dataDir, "backups");
  const workRoot = path.join(dataDir, ".backup-work");
  const workDir = path.join(workRoot, randomUUID());
  mkdirSync(backupDir, { recursive: true });
  mkdirSync(workDir, { recursive: true });
  const snapshotPath = path.join(workDir, "database.sqlite");
  const zipPath = path.join(workDir, "payload.zip");
  const now = new Date();
  const id = `backup-${stamp(now)}-${randomUUID().slice(0, 8)}${BACKUP_EXTENSION}`;
  const outputPath = path.join(backupDir, id);
  try {
    createDatabaseSnapshot(databasePath, snapshotPath);
    const uploads = collectFiles(path.join(dataDir, "uploads"));
    const zip = new AdmZip();
    zip.addLocalFile(snapshotPath, "", "database.sqlite");
    for (const file of uploads) zip.addLocalFile(file.absolute, path.posix.join("uploads", file.relativeDir), file.name);
    const appSecret = path.join(dataDir, ".app-secret");
    if (existsSync(appSecret)) zip.addLocalFile(appSecret, "", ".app-secret");
    if (input.envContents) zip.addFile(".env", Buffer.from(input.envContents, "utf8"));
    const manifest = {
      format: "rehabintl-crm-backup",
      version: 1,
      createdAt: now.toISOString(),
      databaseSha256: await sha256File(snapshotPath),
      uploadFiles: uploads.length,
      uploadBytes: uploads.reduce((sum, file) => sum + file.size, 0),
      appSecretIncluded: existsSync(appSecret),
      envIncluded: Boolean(input.envContents),
    };
    zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2), "utf8"));
    zip.writeZip(zipPath);
    await encryptFile(zipPath, outputPath, input.passphrase);
    const info = fileInfo(outputPath);
    await pruneBackups(dataDir, input.retentionDays ?? 30, input.retentionCount ?? 30);
    return { ...info, sha256: await sha256File(outputPath), manifest };
  } catch (error) {
    try { unlinkSync(outputPath); } catch { /* incomplete output may not exist */ }
    throw error;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export function listBackups(dataDir: string): BackupInfo[] {
  const dir = path.join(path.resolve(/*turbopackIgnore: true*/ dataDir), "backups");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(isBackupId).map((name) => fileInfo(path.join(dir, name))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function resolveBackupPath(dataDir: string, id: string) {
  if (!isBackupId(id)) throw new Error("备份文件名无效");
  const file = path.join(path.resolve(/*turbopackIgnore: true*/ dataDir), "backups", id);
  if (!existsSync(file)) throw new Error("备份文件不存在");
  return file;
}

export async function pruneBackups(dataDir: string, retentionDays: number, retentionCount: number) {
  const backups = listBackups(dataDir);
  const keepDays = Math.max(1, Math.min(3650, Number(retentionDays) || 30));
  const keepCount = Math.max(1, Math.min(1000, Number(retentionCount) || 30));
  const cutoff = Date.now() - keepDays * 86400_000;
  let removed = 0;
  backups.forEach((backup, index) => {
    if (index >= keepCount || (new Date(backup.createdAt).getTime() < cutoff && backups.length - removed > 1)) {
      unlinkSync(resolveBackupPath(dataDir, backup.id));
      removed += 1;
    }
  });
  return removed;
}

export async function stageEncryptedRestore(input: { dataDir: string; encryptedFile: string; passphrase: string }) {
  validatePassphrase(input.passphrase);
  const dataDir = path.resolve(/*turbopackIgnore: true*/ input.dataDir);
  const marker = path.join(dataDir, ".restore-pending.json");
  if (existsSync(marker)) throw new Error("已有一个待恢复任务，请先重启系统完成恢复");
  const stageRoot = path.join(dataDir, ".restore-staging");
  const stageDir = path.join(stageRoot, randomUUID());
  const zipPath = path.join(stageDir, "payload.zip");
  const payloadDir = path.join(stageDir, "payload");
  mkdirSync(payloadDir, { recursive: true });
  try {
    await decryptFile(input.encryptedFile, zipPath, input.passphrase);
    const manifest = extractAndValidate(zipPath, payloadDir);
    validateSnapshot(path.join(payloadDir, "database.sqlite"));
    const markerData = { version: 1, stageDir: path.relative(dataDir, stageDir).replace(/\\/g, "/"), requestedAt: new Date().toISOString(), manifest };
    const temporaryMarker = `${marker}.tmp`;
    writeFileSync(temporaryMarker, JSON.stringify(markerData, null, 2), { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryMarker, marker);
    try { unlinkSync(zipPath); } catch { /* extracted payload is sufficient */ }
    return { restartRequired: true, manifest };
  } catch (error) {
    rmSync(stageDir, { recursive: true, force: true });
    throw friendlyDecryptError(error);
  }
}

export function applyPendingRestore(dataDirInput: string) {
  const dataDir = path.resolve(/*turbopackIgnore: true*/ dataDirInput);
  const markerPath = path.join(dataDir, ".restore-pending.json");
  if (!existsSync(markerPath)) return null;
  const marker = JSON.parse(readFileSync(markerPath, "utf8")) as { stageDir?: string; requestedAt?: string; manifest?: Record<string, unknown> };
  if (!marker.stageDir || marker.stageDir.includes("..") || path.isAbsolute(marker.stageDir)) throw new Error("待恢复标记无效，请联系管理员检查 data 目录");
  const stageRoot = path.join(dataDir, ".restore-staging");
  const stageDir = ensureInside(stageRoot, path.resolve(/*turbopackIgnore: true*/ dataDir, marker.stageDir));
  const payloadDir = path.join(stageDir, "payload");
  const restoredDb = path.join(payloadDir, "database.sqlite");
  validateSnapshot(restoredDb);
  const recoveryDir = path.join(dataDir, `recovery-before-restore-${stamp(new Date())}-${randomUUID().slice(0, 8)}`);
  mkdirSync(recoveryDir, { recursive: true });
  const moved: Array<{ from: string; to: string }> = [];
  const targets = ["rehabintl-crm.sqlite", "rehabintl-crm.sqlite-wal", "rehabintl-crm.sqlite-shm", "uploads", ".app-secret", ".env.restore"];
  try {
    for (const name of targets) {
      const current = path.join(dataDir, name);
      if (existsSync(current)) { const recovery = path.join(recoveryDir, name); renameSync(current, recovery); moved.push({ from: current, to: recovery }); }
    }
    renameSync(restoredDb, path.join(dataDir, "rehabintl-crm.sqlite"));
    const restoredUploads = path.join(payloadDir, "uploads");
    if (existsSync(restoredUploads)) renameSync(restoredUploads, path.join(dataDir, "uploads")); else mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
    const restoredSecret = path.join(payloadDir, ".app-secret");
    if (existsSync(restoredSecret)) renameSync(restoredSecret, path.join(dataDir, ".app-secret"));
    const restoredEnv = path.join(payloadDir, ".env");
    if (existsSync(restoredEnv)) renameSync(restoredEnv, path.join(dataDir, ".env.restore"));
    writeFileSync(path.join(dataDir, "last-restore-report.json"), JSON.stringify({ completedAt: new Date().toISOString(), requestedAt: marker.requestedAt, manifest: marker.manifest, recoveryDir }, null, 2), "utf8");
    unlinkSync(markerPath);
    rmSync(stageDir, { recursive: true, force: true });
    return { recoveryDir };
  } catch (error) {
    for (const name of ["rehabintl-crm.sqlite", "rehabintl-crm.sqlite-wal", "rehabintl-crm.sqlite-shm", "uploads", ".app-secret", ".env.restore"]) rmSync(path.join(dataDir, name), { recursive: true, force: true });
    for (const item of moved.reverse()) if (existsSync(item.to)) renameSync(item.to, item.from);
    throw error;
  }
}

async function encryptFile(source: string, destination: string, passphrase: string) {
  const salt = randomBytes(SALT_BYTES); const iv = randomBytes(IV_BYTES);
  const key = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const output = createWriteStream(destination, { mode: 0o600 });
  output.write(Buffer.concat([MAGIC, salt, iv]));
  cipher.pipe(output, { end: false });
  await pipeline(createReadStream(source), cipher);
  await new Promise<void>((resolve, reject) => { output.once("error", reject); output.end(cipher.getAuthTag(), resolve); });
}

async function decryptFile(source: string, destination: string, passphrase: string) {
  const size = statSync(source).size;
  if (size <= HEADER_BYTES + TAG_BYTES) throw new Error("备份文件不完整");
  const fd = openSync(source, "r");
  const header = Buffer.alloc(HEADER_BYTES); const tag = Buffer.alloc(TAG_BYTES);
  try { readSync(fd, header, 0, header.length, 0); readSync(fd, tag, 0, tag.length, size - TAG_BYTES); } finally { closeSync(fd); }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("不是有效的 RehabIntl 加密备份");
  const salt = header.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = header.subarray(MAGIC.length + SALT_BYTES, HEADER_BYTES);
  const key = scryptSync(passphrase, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const decipher = createDecipheriv("aes-256-gcm", key, iv); decipher.setAuthTag(tag);
  await pipeline(createReadStream(source, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }), decipher, createWriteStream(destination, { mode: 0o600 }));
}

function createDatabaseSnapshot(databasePath: string, destination: string) {
  const db = new DatabaseSync(databasePath);
  try { db.exec("PRAGMA busy_timeout=15000"); db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`); } finally { db.close(); }
  validateSnapshot(destination);
}

function validateSnapshot(file: string) {
  if (!existsSync(file)) throw new Error("备份中缺少数据库文件");
  const db = new DatabaseSync(file);
  try {
    const check = db.prepare("PRAGMA quick_check").get() as Record<string, string>;
    if (!Object.values(check).includes("ok")) throw new Error("数据库完整性检查失败");
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>;
    const names = new Set(rows.map((row) => row.name));
    if (REQUIRED_TABLES.some((table) => !names.has(table))) throw new Error("备份数据库结构不完整");
  } finally { db.close(); }
}

function extractAndValidate(zipPath: string, destination: string) {
  const zip = new AdmZip(zipPath); const entries = zip.getEntries();
  if (entries.length > 10_000) throw new Error("备份文件条目过多");
  let total = 0;
  for (const entry of entries) {
    const name = entry.entryName.replace(/\\/g, "/");
    if (path.isAbsolute(name) || name.split("/").includes("..") || !isAllowedEntry(name)) throw new Error(`备份中包含不允许的路径：${name}`);
    total += Number(entry.header.size || 0); if (total > 4 * 1024 * 1024 * 1024) throw new Error("备份解压后超过4GB限制");
    if (entry.isDirectory) { mkdirSync(ensureInside(destination, path.resolve(/*turbopackIgnore: true*/ destination, name)), { recursive: true }); continue; }
    const target = ensureInside(destination, path.resolve(/*turbopackIgnore: true*/ destination, name)); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, entry.getData(), { mode: name === ".app-secret" || name === ".env" ? 0o600 : 0o640 });
  }
  const manifestPath = path.join(destination, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("备份清单缺失");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { format?: string; databaseSha256?: string };
  if (manifest.format !== "rehabintl-crm-backup") throw new Error("备份格式不兼容");
  if (manifest.databaseSha256 && sha256FileSync(path.join(destination, "database.sqlite")) !== manifest.databaseSha256) throw new Error("数据库校验值不一致");
  return manifest;
}

function collectFiles(root: string) {
  const files: Array<{ absolute: string; relativeDir: string; name: string; size: number }> = [];
  if (!existsSync(root)) return files;
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const absolute = path.join(dir, name); const stat = lstatSync(absolute); if (stat.isSymbolicLink()) continue; if (stat.isDirectory()) walk(absolute); else if (stat.isFile()) { const relative = path.relative(root, absolute); files.push({ absolute, relativeDir: path.dirname(relative) === "." ? "" : path.dirname(relative).replace(/\\/g, "/"), name: path.basename(relative), size: stat.size }); } } };
  walk(root); return files;
}

async function sha256File(file: string) {
  const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer); return hash.digest("hex");
}

function sha256FileSync(file: string) {
  const hash = createHash("sha256"); const fd = openSync(file, "r"); const buffer = Buffer.alloc(1024 * 1024); let position = 0;
  try { for (;;) { const bytes = readSync(fd, buffer, 0, buffer.length, position); if (!bytes) break; hash.update(buffer.subarray(0, bytes)); position += bytes; } } finally { closeSync(fd); }
  return hash.digest("hex");
}

function fileInfo(file: string): BackupInfo { const stat = statSync(file); return { id: path.basename(file), filename: path.basename(file), size: stat.size, createdAt: stat.mtime.toISOString() }; }
function isBackupId(value: string) { return /^backup-\d{8}-\d{6}-[a-f0-9]{8}\.ricrmbak$/i.test(value); }
function stamp(date: Date) { return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15); }
function validatePassphrase(value: string) { if (value.length < 12) throw new Error("备份密码至少需要12位"); if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) throw new Error("备份密码需同时包含字母和数字"); }
function isAllowedEntry(name: string) { return ["manifest.json", "database.sqlite", ".app-secret", ".env"].includes(name) || name.startsWith("uploads/"); }
function ensureInside(base: string, target: string) { const root = path.resolve(/*turbopackIgnore: true*/ base) + path.sep; const resolved = path.resolve(/*turbopackIgnore: true*/ target); if (resolved !== path.resolve(/*turbopackIgnore: true*/ base) && !resolved.startsWith(root)) throw new Error("备份路径越界"); return resolved; }
function friendlyDecryptError(error: unknown) { const message = error instanceof Error ? error.message : "恢复失败"; return /authenticate|auth tag|Unsupported state/i.test(message) ? new Error("备份密码不正确或文件已损坏") : error; }
