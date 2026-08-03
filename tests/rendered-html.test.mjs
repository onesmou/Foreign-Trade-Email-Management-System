import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("contains the complete RehabIntl inquiry workflow", async () => {
  const [page, layout, hosting] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /RehabIntl 询盘工作台/);
  assert.match(page, /客户询盘/);
  assert.match(page, /录入新邮件/);
  assert.match(page, /开始分析/);
  assert.match(page, /英文回复草稿/);
  assert.match(hosting, /"d1": "DB"/);
  assert.doesNotMatch(page + layout, /codex-preview|Your site is taking shape/);
});
