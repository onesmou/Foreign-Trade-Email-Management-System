import assert from "node:assert/strict";
import { createServer } from "node:http";

const app = "http://127.0.0.1:3105";
const origin = app;
let cookie = "";

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Origin", origin);
  if (cookie) headers.set("Cookie", cookie);
  const response = await fetch(`${app}${path}`, { ...options, headers });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const body = await response.json();
  return { response, body };
}

const mock = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.url?.endsWith("/responses")) res.end(JSON.stringify({ output_text: "连接成功" }));
  else res.end(JSON.stringify({ choices: [{ message: { content: "连接成功" } }] }));
});

await new Promise((resolve) => mock.listen(3210, "127.0.0.1", resolve));
try {
  let result = await request("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Test Admin", email: "admin@example.com", password: "Testing!23456", companyName: "RehabIntl Test" }) });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.ok(cookie);

  result = await request("/api/auth/me");
  assert.equal(result.body.user.role, "admin");

  const rawEmail = `From: Maria Lopez <maria@sunrise-rehab.mx>\nSubject: Need standing beds\n\nPlease quote 20 electric standing beds.\n\nMaria Lopez\nSunrise Rehab Center\nMexico`;
  result = await request("/api/inquiries/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rawEmail }) });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.parsed.email, "maria@sunrise-rehab.mx");

  result = await request("/api/inquiries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rawEmail }) });
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.inquiry.company, "Sunrise Rehab Center");

  const form = new FormData();
  form.append("files", new File(["Model ST-20 electric standing bed. MOQ 10 units. CE certified rehabilitation product."], "standing-bed-product.md", { type: "text/markdown" }));
  result = await request("/api/knowledge", { method: "POST", body: form });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.imported, 1);
  assert.equal(result.body.files[0].category, "产品资料");

  result = await request("/api/backups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ passphrase: "IntegrationBackup2026!" }) });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  const backupId = result.body.backup.id;
  result = await request("/api/backups");
  assert.equal(result.body.backups.length, 1);
  const download = await fetch(`${app}/api/backups/download?id=${encodeURIComponent(backupId)}`, { headers: { Cookie: cookie } });
  assert.equal(download.status, 200);
  assert.equal(Buffer.from(await download.arrayBuffer()).subarray(0, 9).toString("ascii"), "RICRMBAK1");

  for (const apiStyle of ["chat", "responses"]) {
    result = await request("/api/ai/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `Mock ${apiStyle}`, providerKey: "custom", apiStyle, baseUrl: "http://127.0.0.1:3210/v1", model: "mock-model" }) });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.ok, true);
  }

  result = await request("/api/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: 1, role: "sales" }) });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /至少需要一个启用的管理员/);

  console.log("Integration OK: setup/auth, raw-email parse, inquiry create, knowledge import, encrypted backup/download, chat/responses AI tests, last-admin protection.");
} finally {
  await new Promise((resolve) => mock.close(resolve));
}
