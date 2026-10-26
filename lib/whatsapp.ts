import "server-only";
import pino from "pino";
import QRCode from "qrcode";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import { ConnectionAttempt, whatsappProxy } from "./whatsapp-connection";
import makeWASocket, {
  BufferJSON,
  initAuthCreds,
  proto,
  normalizeMessageContent,
  Browsers,
  downloadMediaMessage,
  jidNormalizedUser,
  type Contact,
  type AuthenticationCreds,
  type SignalDataTypeMap,
  type SignalKeyStore,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { getDb } from "./db";
import { decryptSecret, encryptSecret } from "./security";
import { normalizePhone, type Row } from "./crm";
import { canonicalJid, rememberIdentity } from "./whatsapp-identity";
import { whatsappDispatcher, whatsappMediaUrl } from "./whatsapp-network";
import { boundedBytes, cachedWhatsAppMedia } from "./whatsapp-media";
import sharp from "sharp";
import {
  archiveInbox,
  privateJid,
  saveInboxMessage,
  sendOnce,
  updateDelivery,
} from "./whatsapp-store";

type State = {
  transport: ConnectionAttempt<WASocket>;
  status: string;
  qr: string;
  error: string;
  retries: number;
  connecting: boolean;
  lastSync: string;
  enabled: boolean;
  startedAt: number;
  qrExpiresAt: number;
  network: string;
};
declare global {
  var __crmWa: State | undefined;
}
function state() {
  return (global.__crmWa ??= {
    transport: new ConnectionAttempt<WASocket>(),
    status: "disconnected",
    qr: "",
    error: "",
    retries: 0,
    connecting: false,
    lastSync: "",
    enabled: false,
    startedAt: 0,
    qrExpiresAt: 0,
    network: "尚未发起连接",
  });
}
function read(key: string) {
  return (
    getDb().prepare("SELECT value FROM wa_state WHERE key=?").get(key) as
      { value: string } | undefined
  )?.value;
}
function write(key: string, value: string) {
  getDb()
    .prepare(
      "INSERT INTO wa_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(key, value);
}
function readAuth(key: string) {
  const value = read(`auth:${key}`);
  return value ? JSON.parse(decryptSecret(value), BufferJSON.reviver) : null;
}
function writeAuth(key: string, value: unknown) {
  write(
    `auth:${key}`,
    encryptSecret(JSON.stringify(value, BufferJSON.replacer)),
  );
}
export function whatsappStatus() {
  const s = state();
  return {
    status: s.status,
    qr: s.qr,
    error: s.error,
    lastSync: s.lastSync || read("lastSync") || "",
    enabled: s.enabled,
    startedAt: s.startedAt,
    qrExpiresAt: s.qrExpiresAt,
    network: s.network,
    retryCount: s.retries,
    timeoutSeconds: 25,
    contacts: getDb()
      .prepare(
        "SELECT jid,name,customer_id,selected FROM wa_contacts ORDER BY selected DESC,name LIMIT 500",
      )
      .all(),
    range: getDb()
      .prepare(
        "SELECT MIN(occurred_at) AS earliest,MAX(occurred_at) AS latest,COUNT(*) AS total FROM communications WHERE channel='whatsapp' AND external_id LIKE 'wa:%'",
      )
      .get(),
    verified: false,
    note: "普通 WhatsApp 非官方连接，历史范围以平台实际下发为准。连接成功不代表全部历史已同步；发送状态以平台回执为准。",
  };
}
export async function connectWhatsApp(options: { restart?: boolean } = {}) {
  const s = state();
  if (s.status === "connected") return;
  if (!options.restart && (s.connecting || s.transport.socket)) return;
  if (options.restart) s.retries = 0;
  const attempt = s.transport.begin();
  s.connecting = true;
  s.enabled = true;
  write("enabled", "1");
  s.status = "connecting";
  s.error = "";
  s.qr = "";
  s.qrExpiresAt = 0;
  s.startedAt = Date.now();
  try {
    const proxy = whatsappProxy();
    s.network = proxy.url
      ? `已使用${proxy.source === "WA_PROXY_URL" ? "专用" : "系统已有"}代理 ${proxy.label}`
      : proxy.label;
    const agent = proxy.url
      ? proxy.url.startsWith("socks")
        ? new SocksProxyAgent(proxy.url)
        : new HttpsProxyAgent(proxy.url)
      : undefined;
    const creds: AuthenticationCreds = readAuth("creds") || initAuthCreds();
    for (const c of getDb()
      .prepare("SELECT jid FROM wa_contacts")
      .all() as Row[]) {
      storedIdentity(String(c.jid));
      archiveInbox(canonicalJid(String(c.jid)));
    }
    const keys: SignalKeyStore = {
      get: async <T extends keyof SignalDataTypeMap>(
        type: T,
        ids: string[],
      ) => {
        const result: { [id: string]: SignalDataTypeMap[T] } = {};
        if (!s.transport.current(attempt)) return result;
        for (const id of ids) {
          let value = readAuth(`${type}:${id}`);
          if (type === "app-state-sync-key" && value)
            value = proto.Message.AppStateSyncKeyData.fromObject(value);
          if (value) result[id] = value;
        }
        return result;
      },
      set: async (data) => {
        if (!s.transport.current(attempt)) return;
        const db = getDb();
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const [category, entries] of Object.entries(data))
            for (const [id, value] of Object.entries(entries || {})) {
              const key = `${category}:${id}`;
              if (value) writeAuth(key, value);
              else
                db.prepare("DELETE FROM wa_state WHERE key=?").run(
                  `auth:${key}`,
                );
            }
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
      },
    };
    const socket = makeWASocket({
      auth: { creds, keys },
      logger: pino({ level: "silent" }),
      browser: Browsers.ubuntu("Chrome"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      emitOwnEvents: true,
      getMessage: async (key) => {
        const row = getDb()
          .prepare(
            "SELECT payload_cipher FROM wa_messages WHERE jid=? AND message_key=?",
          )
          .get(canonicalJid(key.remoteJid || ""), key.id || "") as
          Row | undefined;
        return row?.payload_cipher
          ? proto.WebMessageInfo.decode(
              Buffer.from(decryptSecret(String(row.payload_cipher)), "base64"),
            ).message || undefined
          : undefined;
      },
      agent,
      fetchAgent: agent,
      connectTimeoutMs: 15000,
      defaultQueryTimeoutMs: 20000,
      qrTimeout: 60000,
    });
    if (!s.transport.attach(attempt, socket)) return;
    s.transport.watch(attempt, 25000, () => {
      s.transport.close();
      s.connecting = false;
      s.status = "error";
      s.error =
        "25 秒内未能取得二维码，连接已停止。请检查运行 CRM 的电脑/服务器是否能访问 WhatsApp，或配置可用代理后重新尝试。";
    });
    socket.ev.on("creds.update", () => {
      if (s.transport.current(attempt)) writeAuth("creds", creds);
    });
    socket.ev.on("connection.update", async (update) => {
      if (!s.transport.current(attempt)) return;
      if (update.qr) {
        try {
          const qr = await QRCode.toDataURL(update.qr, {
            width: 280,
            margin: 2,
          });
          if (!s.transport.current(attempt)) return;
          s.qr = qr;
          s.status = "qr";
          s.connecting = false;
          s.error = "";
          s.qrExpiresAt = Date.now() + 60000;
          s.transport.watch(attempt, 65000, () => {
            s.transport.close();
            s.status = "error";
            s.qr = "";
            s.qrExpiresAt = 0;
            s.error = "二维码已过期，请点击重新获取二维码。";
          });
        } catch {
          if (s.transport.current(attempt)) {
            s.transport.close();
            s.connecting = false;
            s.status = "error";
            s.error = "二维码生成失败，请重新尝试。";
          }
        }
      }
      if (update.connection === "open") {
        s.transport.clearDeadline();
        s.connecting = false;
        s.qrExpiresAt = 0;
        s.status = "connected";
        s.qr = "";
        s.error = "";
        s.retries = 0;
        write("lastSync", new Date().toISOString());
      }
      if (update.connection === "close") {
        if (!s.transport.release(attempt)) return;
        s.transport.close();
        s.qr = "";
        s.status = "disconnected";
        s.connecting = false;
        const code = (
          update.lastDisconnect?.error as
            { output?: { statusCode?: number } } | undefined
        )?.output?.statusCode;
        if (code === 401) {
          s.enabled = false;
          write("enabled", "0");
          s.error = "授权已失效，请解除旧连接后重新扫码。已归档记录不会删除。";
        } else if (s.enabled && s.retries < 3) {
          s.retries++;
          s.status = "reconnecting";
          s.error = `连接未成功，准备第 ${s.retries}/3 次重试。可停止尝试后检查网络。`;
          s.transport.schedule(s.transport.generation, 3000 * s.retries, () => {
            if (s.enabled) void connectWhatsApp();
          });
        } else {
          s.status = "error";
          s.error =
            "无法连接 WhatsApp，自动尝试已停止。请确认 CRM 所在电脑/服务器及代理的网络可达，然后点击重新尝试。";
        }
      }
    });
    socket.ev.on("contacts.upsert", (contacts) => {
      if (!s.transport.current(attempt)) return;
      for (const c of contacts) ingestContact(c);
    });
    socket.ev.on("contacts.update", (contacts) => {
      if (!s.transport.current(attempt)) return;
      for (const c of contacts) if (c.id) ingestContact(c as Contact);
    });
    socket.ev.on("lid-mapping.update", ({ lid, pn }) => {
      if (!s.transport.current(attempt)) return;
      if (rememberIdentity(lid, pn)) archiveInbox(canonicalJid(lid));
    });
    socket.ev.on("chats.upsert", (chats) => {
      if (!s.transport.current(attempt)) return;
      for (const c of chats) if (c.id) upsertContact(c.id, c.name || "");
    });
    socket.ev.on("messages.update", (updates) => {
      if (!s.transport.current(attempt)) return;
      for (const { key, update } of updates) {
        if (update.message && key.remoteJid && key.id)
          archiveMessage({
            key,
            message: update.message,
            messageTimestamp: update.messageTimestamp,
          });
        if (
          key.remoteJid &&
          key.id &&
          typeof update.status === "number" &&
          update.status >= 2
        )
          updateDelivery(
            key.remoteJid,
            key.id,
            update.status >= 4
              ? "read"
              : update.status >= 3
                ? "delivered"
                : "accepted",
          );
      }
    });
    socket.ev.on(
      "messaging-history.set",
      ({ contacts, messages, lidPnMappings }) => {
        if (!s.transport.current(attempt)) return;
        for (const m of lidPnMappings || []) rememberIdentity(m.lid, m.pn);
        for (const c of contacts) ingestContact(c);
        for (const m of messages) archiveMessage(m, true);
      },
    );
    socket.ev.on("messages.upsert", ({ messages }) => {
      if (!s.transport.current(attempt)) return;
      for (const m of messages) archiveMessage(m);
    });
  } catch (e) {
    if (!s.transport.current(attempt)) return;
    s.transport.close();
    s.connecting = false;
    s.status = "error";
    s.error = `WhatsApp 连接未完成：${(e as Error).message.replace(/(https?|socks\w*):\/\/[^\s/@]+:[^\s/@]+@/g, "$1://***@").slice(0, 300)}`;
  } finally {
    if (s.transport.current(attempt)) s.connecting = false;
  }
}
function upsertContact(jid: string, name: string) {
  jid = canonicalJid(jid);
  if (!privateJid(jid)) return;
  getDb()
    .prepare(
      "INSERT INTO wa_contacts(jid,name) VALUES(?,?) ON CONFLICT(jid) DO UPDATE SET name=COALESCE(NULLIF(excluded.name,''),name)",
    )
    .run(jid, name);
}
function ingestContact(c: Contact) {
  if (c.lid) rememberIdentity(c.id, c.lid);
  if (c.phoneNumber) rememberIdentity(c.id, c.phoneNumber);
  upsertContact(c.id, c.name || c.notify || c.verifiedName || "");
  if (c.imgUrl === null)
    getDb()
      .prepare(
        "UPDATE wa_contacts SET avatar='',avatar_checked_at=?,avatar_status='未设置头像' WHERE jid=?",
      )
      .run(Date.now(), canonicalJid(c.id));
  else if (c.imgUrl)
    getDb()
      .prepare(
        "UPDATE wa_contacts SET avatar_checked_at=0,avatar_status='' WHERE jid=?",
      )
      .run(canonicalJid(c.id));
  archiveInbox(canonicalJid(c.id));
}
function storedIdentity(jid: string) {
  const normalized = jidNormalizedUser(jid),
    [id, domain] = normalized.split("@");
  if (!/^\d+$/.test(id) || !["lid", "s.whatsapp.net"].includes(domain)) return;
  const saved = readAuth(
    `lid-mapping:${id}${domain === "lid" ? "_reverse" : ""}`,
  );
  if (typeof saved === "string" && /^\d+$/.test(saved))
    rememberIdentity(
      normalized,
      `${saved}@${domain === "lid" ? "s.whatsapp.net" : "lid"}`,
    );
}
export function archiveMessage(message: WAMessage, history = false) {
  const remote = message.key.remoteJid;
  if (!remote || !message.key.id || !privateJid(remote)) return;
  if (message.key.remoteJidAlt)
    rememberIdentity(remote, message.key.remoteJidAlt);
  else storedIdentity(remote);
  const db = getDb();
  const linked = db
    .prepare(
      "SELECT jid FROM wa_contacts WHERE jid=? AND selected=1 AND customer_id IS NOT NULL",
    )
    .get(canonicalJid(remote)) as Row | undefined;
  const jid = linked ? String(linked.jid) : canonicalJid(remote);
  upsertContact(jid, message.key.fromMe ? "" : message.pushName || "");
  const content = normalizeMessageContent(
    message.message?.deviceSentMessage?.message || message.message,
  );
  const media =
    content?.documentMessage ||
    content?.imageMessage ||
    content?.videoMessage ||
    content?.audioMessage ||
    content?.stickerMessage;
  let wire = message.message?.deviceSentMessage?.message || message.message;
  let once = Boolean(
    message.message?.viewOnceMessage ||
    message.message?.viewOnceMessageV2 ||
    message.message?.viewOnceMessageV2Extension ||
    (media && "viewOnce" in media && media.viewOnce),
  );
  for (let depth = 0; wire && depth < 8; depth++) {
    if (
      wire.viewOnceMessage ||
      wire.viewOnceMessageV2 ||
      wire.viewOnceMessageV2Extension
    ) {
      once = true;
      break;
    }
    wire =
      wire.ephemeralMessage?.message ||
      wire.deviceSentMessage?.message ||
      wire.documentWithCaptionMessage?.message;
  }
  const mediaName =
    content?.documentMessage?.fileName ||
    (content?.imageMessage
      ? "图片.jpg"
      : content?.videoMessage
        ? "视频.mp4"
        : content?.audioMessage
          ? "语音.ogg"
          : "贴纸.webp");
  const text =
    content?.conversation ||
    content?.extendedTextMessage?.text ||
    content?.documentMessage?.caption ||
    content?.imageMessage?.caption ||
    content?.videoMessage?.caption ||
    (content?.documentMessage
      ? `[附件：${content.documentMessage.fileName || "文件"}]`
      : content?.imageMessage
        ? "[图片消息]"
        : content?.videoMessage
          ? "[视频消息]"
          : content?.audioMessage
            ? "[语音消息，尚未转写]"
            : content?.stickerMessage
              ? "[贴纸]"
              : "");
  if (!text) return;
  const timestamp =
    Number(message.messageTimestamp || 0) || Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || timestamp < 0 || timestamp > 253402300799)
    return;
  saveInboxMessage({
    jid,
    key: message.key.id,
    fromMe: Boolean(message.key.fromMe),
    body: once ? "[阅后即焚媒体，请在 WhatsApp 中查看；CRM 不保存原件]" : text,
    timestamp,
    rawKey: message.key,
    kind: once ? "view-once" : media ? "media" : "text",
    payloadCipher: once
      ? undefined
      : encryptSecret(
          Buffer.from(
            proto.WebMessageInfo.encode({
              key: message.key,
              message: content,
              messageTimestamp: message.messageTimestamp,
            }).finish(),
          ).toString("base64"),
        ),
    mediaName: media && !once ? mediaName.slice(0, 255) : "",
    mediaMime: media?.mimetype || "application/octet-stream",
    mediaSize: Number(media?.fileLength || 0),
    analyze: !history,
  });
  const now = new Date().toISOString();
  state().lastSync = now;
  write("lastSync", now);
}
export function selectContact(
  jid: string,
  customerId: number,
  selected: boolean,
) {
  jid = canonicalJid(jid);
  const row = getDb().prepare("SELECT * FROM wa_contacts WHERE jid=?").get(jid);
  if (!row) throw new Error("未发现此联系人。请等待同步或检查号码");
  getDb()
    .prepare(
      "UPDATE wa_contacts SET default_project_id=CASE WHEN customer_id=? THEN default_project_id ELSE NULL END,customer_id=?,selected=? WHERE jid=?",
    )
    .run(customerId, customerId, selected ? 1 : 0, jid);
  if (selected) archiveInbox(jid);
}
export function whatsappConnected() {
  return state().status === "connected";
}
export async function sendWhatsAppText(input: {
  requestId: string;
  jid: string;
  body: string;
  userId: number;
}) {
  const socket = state().transport.socket;
  if (!socket || state().status !== "connected")
    throw new Error("WhatsApp尚未连接，未发送");
  return sendOnce(input, (jid, text, messageId) =>
    socket.sendMessage(jid, { text }, { messageId }),
  );
}
export async function requestWhatsAppHistory(jid: string) {
  jid = canonicalJid(jid);
  const socket = state().transport.socket;
  if (!socket || state().status !== "connected")
    throw new Error("WhatsApp尚未连接");
  const oldest = getDb()
    .prepare(
      "SELECT * FROM wa_messages WHERE jid=? ORDER BY timestamp,id LIMIT 1",
    )
    .get(jid) as Row | undefined;
  if (!oldest)
    throw new Error(
      "还没有可用的历史定位消息。请先在手机打开此聊天并等待平台同步；本系统不能保证拉取全部旧记录",
    );
  await socket.fetchMessageHistory(
    50,
    JSON.parse(String(oldest.raw_key)),
    Number(oldest.timestamp) * 1000,
  );
}
const syncRequests = new Map<string, number>();
export async function refreshWhatsAppChat(jid: string) {
  jid = canonicalJid(jid);
  const socket = state().transport.socket;
  if (!socket || !whatsappConnected())
    throw new Error(
      "WhatsApp 尚未连接，请先恢复连接；刷新页面不能恢复断线期间尚未下发的消息",
    );
  if (Date.now() - (syncRequests.get(jid) || 0) < 30000)
    return "已请求同步，请稍等平台返回；不会重复发送请求";
  const row = getDb()
    .prepare(
      "SELECT raw_key FROM wa_messages WHERE jid=? ORDER BY timestamp DESC,id DESC LIMIT 1",
    )
    .get(jid) as Row | undefined;
  if (!row)
    throw new Error("尚无消息定位点，请先在手机打开此聊天并等待平台下发");
  syncRequests.set(jid, Date.now());
  try {
    await socket.fetchMessageHistory(
      50,
      JSON.parse(String(row.raw_key)),
      Date.now(),
    );
  } catch (e) {
    syncRequests.delete(jid);
    throw e;
  }
  return "已向手机请求最近50条记录，请稍候；平台不保证补齐全部历史";
}
export async function downloadWhatsAppMedia(id: number) {
  return cachedWhatsAppMedia(id, async (row) => {
    const decoded = proto.WebMessageInfo.decode(
      Buffer.from(decryptSecret(String(row.payload_cipher)), "base64"),
    );
    if (!decoded.key) throw new Error("附件信息不完整");
    const message: WAMessage = { ...decoded, key: decoded.key };
    const content = normalizeMessageContent(message.message);
    const media =
      content?.imageMessage ||
      content?.documentMessage ||
      content?.videoMessage ||
      content?.audioMessage ||
      content?.stickerMessage;
    if (!media) throw new Error("这条消息没有可下载的原件");
    if (media.url) whatsappMediaUrl(media.url);
    const socket = state().transport.socket;
    try {
      return await downloadMediaMessage(
        message,
        "stream",
        {
          options: {
            signal: AbortSignal.timeout(30000),
            dispatcher: whatsappDispatcher(),
          } as RequestInit,
        },
        socket && whatsappConnected()
          ? {
              logger: pino({ level: "silent" }),
              reuploadRequest: socket.updateMediaMessage,
            }
          : undefined,
      );
    } catch {
      throw new Error(
        "附件下载未完成：请检查服务器及代理网络。若媒体已过期或平台无法恢复，请在手机保存或让客户重新发送",
      );
    }
  });
}
const avatarRequests = new Map<string, Promise<void>>();
export async function refreshWhatsAppAvatar(input: string, force = false) {
  const jid = canonicalJid(input),
    socket = state().transport.socket;
  const row = getDb()
    .prepare("SELECT avatar_checked_at FROM wa_contacts WHERE jid=?")
    .get(jid) as Row | undefined;
  if (!socket || !whatsappConnected() || !row) return;
  if (avatarRequests.has(jid)) return avatarRequests.get(jid);
  if (Date.now() - Number(row.avatar_checked_at) < (force ? 60000 : 86400000))
    return;
  const generation = state().transport.generation;
  const task = (async () => {
    getDb()
      .prepare("UPDATE wa_contacts SET avatar_checked_at=? WHERE jid=?")
      .run(Date.now(), jid);
    try {
      const url = await socket.profilePictureUrl(jid, "preview", 12000);
      if (!url) throw new Error("头像不可见");
      const response = await fetch(whatsappMediaUrl(url), {
        signal: AbortSignal.timeout(15000),
        redirect: "error",
        dispatcher: whatsappDispatcher(),
      } as RequestInit);
      if (!response.ok || !response.body) throw new Error("头像不可见");
      const bytes = await boundedBytes(response.body, 2 * 1024 * 1024);
      const avatar = await sharp(bytes, { limitInputPixels: 16000000 })
        .rotate()
        .resize(96, 96, { fit: "cover" })
        .webp({ quality: 80 })
        .toBuffer();
      if (!state().transport.current(generation)) return;
      getDb()
        .prepare(
          "UPDATE wa_contacts SET avatar=?,avatar_status='已同步' WHERE jid=?",
        )
        .run(`data:image/webp;base64,${avatar.toString("base64")}`, jid);
    } catch {
      if (state().transport.current(generation))
        getDb()
          .prepare(
            "UPDATE wa_contacts SET avatar_status='未能获取头像，可能受隐私设置或网络限制' WHERE jid=?",
          )
          .run(jid);
    }
  })();
  avatarRequests.set(jid, task);
  try {
    await task;
  } finally {
    avatarRequests.delete(jid);
  }
}
export async function disconnectWhatsApp() {
  const s = state();
  s.enabled = false;
  write("enabled", "0");
  s.qr = "";
  const socket = s.transport.socket;
  s.transport.release(s.transport.generation);
  s.transport.close();
  s.connecting = false;
  s.qrExpiresAt = 0;
  if (socket) {
    try {
      await socket.logout();
    } catch {
      socket.end(undefined);
    }
  }
  getDb().prepare("DELETE FROM wa_state WHERE key LIKE 'auth:%'").run();
  s.status = "disconnected";
  s.error = "已解除连接，历史归档仍保留";
}
export function cancelWhatsApp() {
  const s = state();
  s.enabled = false;
  write("enabled", "0");
  s.transport.close();
  s.connecting = false;
  s.qr = "";
  s.qrExpiresAt = 0;
  s.status = "disconnected";
  s.error = "已停止连接尝试。已保存的授权和归档记录均保留，可重新尝试。";
}
export async function resumeWhatsApp() {
  if (read("enabled") === "1" && read("auth:creds")) await connectWhatsApp();
}
export function addPhoneContact(phone: string, name: string) {
  const normalized = normalizePhone(phone);
  if (normalized.length < 7 || normalized.length > 15)
    throw new Error("请输入含国家区号的有效号码");
  const jid = `${normalized}@s.whatsapp.net`;
  upsertContact(jid, name);
  return jid;
}
