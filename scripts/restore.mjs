import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stageEncryptedRestore } from "../lib/backup-core.ts";

loadEnv(path.join(process.cwd(), ".env"));
const backupFile = process.argv[2] ? path.resolve(process.argv[2]) : "";
if (!backupFile || !existsSync(backupFile)) throw new Error("用法：npm run restore -- /备份文件绝对路径/backup-xxx.ricrmbak");
const passphrase = process.env.BACKUP_PASSPHRASE || "";
if (!passphrase) throw new Error("请先在 .env 中设置该备份使用的 BACKUP_PASSPHRASE");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), "data"));
const result = await stageEncryptedRestore({ dataDir, encryptedFile: backupFile, passphrase });
console.log(JSON.stringify({ ok: true, restartRequired: result.restartRequired, message: "备份已验证并暂存。请立即重启Node项目。" }));

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
