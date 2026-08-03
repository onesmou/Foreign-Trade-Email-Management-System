import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships the requested CRM workflows", async () => {
  const [page, providers, knowledge, auth, backup, deploy] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/knowledge.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/backup-core.ts", import.meta.url), "utf8"),
    readFile(new URL("../DEPLOY_BAOTA.md", import.meta.url), "utf8"),
  ]);
  assert.match(page, /录入邮件全文/);
  assert.match(page, /中文翻译/);
  assert.match(page, /公司与产品资料/);
  assert.match(providers, /api\.deepseek\.com/);
  assert.match(providers, /dashscope\.aliyuncs\.com/);
  assert.match(providers, /api\.moonshot\.cn/);
  assert.match(knowledge, /Agent \/ 项目文件/);
  assert.match(knowledge, /ingestZip/);
  assert.match(auth, /httpOnly: true/);
  assert.match(backup, /aes-256-gcm/);
  assert.match(backup, /VACUUM INTO/);
  assert.match(page, /备份恢复/);
  assert.match(deploy, /宝塔/);
});
