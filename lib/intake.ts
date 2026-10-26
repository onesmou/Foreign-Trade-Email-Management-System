import "server-only";
import {
  createHmac,
  randomBytes,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { getDb } from "./db";
import { decryptSecret } from "./security";
import {
  findOrCreateCustomer,
  addProject,
  addCommunication,
  type Row,
} from "./crm";
import type { SessionUser } from "./auth";
export function intakeSource(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("咨询入口不可用");
  const s = getDb()
    .prepare("SELECT * FROM intake_sources WHERE id=? AND enabled=1")
    .get(id) as Row | undefined;
  if (!s) throw new Error("咨询入口不可用");
  return s;
}
export const makeIntakeId = () => randomBytes(16).toString("hex");
export function formToken(source: Row) {
  const issued = Date.now(),
    nonce = randomBytes(12).toString("hex"),
    data = `${issued}.${nonce}`;
  return `${data}.${createHmac(
    "sha256",
    decryptSecret(String(source.secret_cipher)),
  )
    .update(data)
    .digest("hex")}`;
}
export function verifyFormToken(source: Row, token: string) {
  const [issued, nonce, hash] = token.split("."),
    time = Number(issued);
  if (
    !Number.isFinite(time) ||
    Date.now() - time < 1500 ||
    Date.now() - time > 3600000 ||
    !nonce ||
    !hash
  )
    throw new Error("请重新打开咨询页面后再提交");
  const expected = createHmac(
    "sha256",
    decryptSecret(String(source.secret_cipher)),
  )
    .update(`${issued}.${nonce}`)
    .digest();
  const actual = Buffer.from(hash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new Error("表单校验失败");
}
export function validWebhook(source: Row, secret: string) {
  const a = createHash("sha256").update(secret).digest(),
    b = createHash("sha256")
      .update(decryptSecret(String(source.secret_cipher)))
      .digest();
  return timingSafeEqual(a, b);
}
export function limitIntake(sourceId: string, ip: string) {
  const db = getDb(),
    now = Math.floor(Date.now() / 1000);
  db.prepare("DELETE FROM intake_limits WHERE expires_at<?").run(now);
  const keys = [
    {
      key: `${sourceId}:minute:${createHash("sha256").update(ip).digest("hex").slice(0, 24)}:${Math.floor(now / 60)}`,
      max: 5,
      expiry: now + 120,
    },
    {
      key: `${sourceId}:day:${Math.floor(now / 86400)}`,
      max: 500,
      expiry: now + 86400,
    },
  ];
  for (const k of keys) {
    db.prepare(
      "INSERT INTO intake_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1",
    ).run(k.key, k.expiry);
    if (
      Number(
        (
          db
            .prepare("SELECT count FROM intake_limits WHERE bucket=?")
            .get(k.key) as Row
        ).count,
      ) > k.max
    )
      throw new Error("提交频繁，请稍后再试");
  }
}
export function saveIntake(
  source: Row,
  input: {
    requestId: string;
    name: string;
    email: string;
    phone: string;
    company: string;
    message: string;
    context: string;
  },
) {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const old = db
      .prepare(
        "SELECT customer_id FROM intake_submissions WHERE source_id=? AND request_id=?",
      )
      .get(source.id, input.requestId) as Row | undefined;
    if (old) {
      db.exec("COMMIT");
      return;
    }
    const user = db
      .prepare(
        "SELECT id,name,email,role FROM users WHERE id=? AND status='active' AND role='admin'",
      )
      .get(source.owner_id) as SessionUser | undefined;
    if (!user) throw new Error("入口负责人不可用");
    const { id } = findOrCreateCustomer(user, {
      ...input,
      source: String(source.source),
      campaign: String(source.campaign),
    });
    let projectId =
      Number(
        (
          db
            .prepare(
              "SELECT id FROM projects WHERE customer_id=? AND stage NOT IN ('成交','暂停','流失') ORDER BY id DESC LIMIT 1",
            )
            .get(id) as Row | undefined
        )?.id,
      ) || undefined;
    if (!projectId) projectId = addProject(id, `${source.name} · 新咨询`);
    addCommunication({
      customerId: id,
      projectId,
      channel:
        String(source.source) === "advertisement" ? "advertisement" : "website",
      body: input.message,
      subject: `${source.name}${source.campaign ? ` · ${source.campaign}` : ""}${input.context ? ` · 来访标记（未验证）：${input.context}` : ""}`,
      externalId: `intake:${source.id}:${input.requestId}`,
      analyze: false,
    });
    db.prepare(
      "INSERT INTO intake_submissions(source_id,request_id,customer_id) VALUES(?,?,?)",
    ).run(source.id, input.requestId, id);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
