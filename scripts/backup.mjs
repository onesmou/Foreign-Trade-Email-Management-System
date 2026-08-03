import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { createEncryptedBackup } from "../lib/backup-core.ts";

loadEnv(path.join(process.cwd(), ".env"));
const passphrase = process.env.BACKUP_PASSPHRASE || "";
if (!passphrase) throw new Error("请先在 .env 中设置 BACKUP_PASSPHRASE");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const backup = await createEncryptedBackup({
  dataDir,
  passphrase,
  envContents: existsSync(path.join(process.cwd(), ".env")) ? readFileSync(path.join(process.cwd(), ".env"), "utf8") : "",
  retentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 30),
  retentionCount: Number(process.env.BACKUP_RETENTION_COUNT || 30),
});
const copiedTo = copyToSecondaryLocation(backup.filename, dataDir);
console.log(JSON.stringify({ ok: true, file: backup.filename, size: backup.size, createdAt: backup.createdAt, sha256: backup.sha256, copiedTo }));

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

function copyToSecondaryLocation(filename, dataDir) {
  const configured = process.env.BACKUP_COPY_DIR?.trim();
  if (!configured) return "";
  const destinationDir = path.resolve(configured);
  const sourceDir = path.join(dataDir, "backups");
  if (destinationDir === sourceDir) return "";
  mkdirSync(destinationDir, { recursive: true });
  copyFileSync(path.join(sourceDir, filename), path.join(destinationDir, filename));
  const keepDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 30));
  const keepCount = Math.max(1, Number(process.env.BACKUP_RETENTION_COUNT || 30));
  const cutoff = Date.now() - keepDays * 86400_000;
  const files = readdirSync(destinationDir).filter((name) => /^backup-\d{8}-\d{6}-[a-f0-9]{8}\.ricrmbak$/i.test(name)).map((name) => ({ name, time: statSync(path.join(destinationDir, name)).mtimeMs })).sort((a, b) => b.time - a.time);
  files.forEach((file, index) => { if (index >= keepCount || (file.time < cutoff && files.length > 1)) unlinkSync(path.join(destinationDir, file.name)); });
  return path.join(destinationDir, filename);
}
