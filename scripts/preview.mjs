// Local, isolated review environment. Never starts a public listener or changes production data.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import path from "node:path";
const port = Number(process.env.CRM_PREVIEW_PORT || 3011);
const base = `http://127.0.0.1:${port}`;
const probe = createServer();
probe.listen(port, "127.0.0.1");
try {
  await once(probe, "listening");
} catch {
  throw new Error(
    `${port}端口已被占用，未停止其他项目。请设置 CRM_PREVIEW_PORT 指定独立端口。`,
  );
}
await new Promise((resolve) => probe.close(resolve));
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      DATA_DIR: path.join(process.cwd(), "data", "v2-preview"),
      CRM_PREVIEW: "1",
      APP_URL: base,
    },
  },
);
let cookie = "";
async function request(url, body) {
  const r = await fetch(base + url, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      Cookie: cookie,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  const d = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(d));
  return d;
}
for (let i = 0; i < 100; i++) {
  try {
    const setup = await request("/api/auth/setup");
    if (setup.needsSetup) {
      await request("/api/auth/setup", {
        name: "本地预览管理员",
        email: "preview@local.test",
        password: "PreviewCRM2026!",
        companyName: "RehabIntl · 本地演示",
      });
      const anna = await request("/api/customers", {
        name: "示例 · Anna",
        email: "anna@example.test",
        company: "示例客户 · 儿童康复项目",
        country: "United Arab Emirates",
        source: "email",
        raw: "From: Anna <anna@example.test>\nSubject: Pediatric gait trainer project\n\nWe are planning a pediatric rehabilitation room. Please share a catalogue and product images.\nAnna",
      });
      await request("/api/customers", {
        customerId: anna.id,
        projectId: anna.projects[0].id,
        channel: "whatsapp",
        raw: "We have confirmed 10 units. Could you check the shipping cost to Dubai?",
        body: "We have confirmed 10 units. Could you check the shipping cost to Dubai?",
        subject: "演示：后续 WhatsApp 沟通（手动示例，并非同步记录）",
      });
      await request("/api/customers", {
        name: "示例 · Daniel",
        email: "daniel@example.test",
        company: "示例客户 · 经销合作",
        country: "Mexico",
        source: "exhibition",
        raw: "We met at an exhibition. Please share your rehabilitation product catalogue for distribution.",
      });
      await request("/api/customers", {
        name: "示例 · Mina",
        phone: "+971500000001",
        company: "示例客户 · 网站咨询",
        country: "United Arab Emirates",
        source: "website",
        raw: "I would like information about therapy tables for our clinic.",
      });
    }
    console.log(
      `\nCRM V2 LOCAL PREVIEW: ${base}\n示例账号：preview@local.test\n示例密码：PreviewCRM2026!\n数据在 data/v2-preview；已保存的真实AI或WhatsApp授权会继续复用，请勿重置或误发测试消息。`,
    );
    break;
  } catch (e) {
    if (i === 99) {
      server.kill();
      throw e;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}
process.on("SIGINT", () => {
  server.kill();
  process.exit(0);
});
await once(server, "exit");
