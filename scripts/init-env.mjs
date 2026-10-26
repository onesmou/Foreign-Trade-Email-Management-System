// Creates fresh server configuration only; never overwrites secrets or imports data.
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
const { values } = parseArgs({
  options: {
    url: { type: "string" },
    output: { type: "string", default: ".env" },
  },
});
if (!values.url) throw new Error("请传入 --url https://你的CRM域名");
const url = new URL(values.url);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  url.pathname !== "/"
)
  throw new Error("APP_URL必须是独立HTTPS域名，不带账号、路径或查询参数");
const output = path.resolve(values.output);
if (existsSync(output))
  throw new Error("配置文件已存在，未覆盖。请保留原密钥并人工核对");
const secret = () => randomBytes(32).toString("hex");
writeFileSync(
  output,
  [
    `APP_URL=${url.origin}`,
    "DATA_DIR=./data",
    `APP_SECRET=${secret()}`,
    `SETUP_TOKEN=${secret()}`,
    `BACKUP_PASSPHRASE=${secret()}`,
    "ALLOW_LOCAL_AI=0",
    "WA_PROXY_URL=",
    "INBOUND_EMAIL_SECRET=",
    "BACKUP_RETENTION_DAYS=30",
    "BACKUP_RETENTION_COUNT=30",
    "",
  ].join("\n"),
  { mode: 0o600, flag: "wx" },
);
console.log(
  `已生成 ${path.basename(output)}，未输出任何密钥。请私下保存SETUP_TOKEN用于首次建管理员，并保存备份密码。不要提交此文件到GitHub。`,
);
