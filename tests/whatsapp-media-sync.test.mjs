import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (
      specifier.startsWith(".") &&
      context.parentURL?.includes("/lib/") &&
      !context.parentURL.includes("/node_modules/") &&
      !path.extname(specifier)
    )
      return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
    return next(specifier, context);
  },
});

test("WhatsApp phone echoes, verified identities, media recovery/cache/permissions, avatars and bounded sync use no live account", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "crm-wa-media-"));
  process.env.DATA_DIR = dir;
  const { getDb } = await import("../lib/db.ts");
  const { encryptSecret, decryptSecret } = await import("../lib/security.ts");
  const {
    archiveMessage,
    refreshWhatsAppAvatar,
    refreshWhatsAppChat,
    requestWhatsAppHistory,
  } = await import("../lib/whatsapp.ts");
  const { rememberIdentity, canonicalJid, normalizeJid } =
    await import("../lib/whatsapp-identity.ts");
  const { boundedBytes, cachedWhatsAppMedia, whatsappMediaFor } =
    await import("../lib/whatsapp-media.ts");
  const { whatsappMediaUrl } = await import("../lib/whatsapp-network.ts");
  const { ConnectionAttempt } = await import("../lib/whatsapp-connection.ts");
  const { customerDetail, customerList } = await import("../lib/crm.ts");
  const db = getDb(),
    pn = "15555550111@s.whatsapp.net",
    lid = "999111@lid";
  const admin = {
      id: 1,
      role: "admin",
      name: "Admin",
      email: "a@example.test",
    },
    sales = { id: 2, role: "sales", name: "Sales", email: "s@example.test" };
  try {
    db.prepare(
      "INSERT INTO users(id,name,email,password_hash,role) VALUES(1,'Admin','a@example.test','none','admin'),(2,'Sales','s@example.test','none','sales')",
    ).run();
    db.prepare(
      "INSERT INTO customers(id,name,email,owner_id) VALUES(1,'Synthetic','customer@example.test',1),(2,'Other','other@example.test',2)",
    ).run();
    db.prepare(
      "INSERT INTO projects(id,customer_id,title) VALUES(1,1,'Synthetic order'),(2,2,'Other order')",
    ).run();
    db.prepare(
      "INSERT INTO wa_contacts(jid,name,customer_id,selected) VALUES(?,?,1,1)",
    ).run(pn, "Synthetic");
    archiveMessage(
      {
        key: { remoteJid: lid, id: "phone-old", fromMe: true },
        message: { conversation: "Reply from phone" },
        messageTimestamp: 1000,
      },
      true,
    );
    assert.equal(
      db.prepare("SELECT count(*) n FROM communications").get().n,
      0,
    );
    db.prepare("INSERT INTO wa_state(key,value) VALUES(?,?)").run(
      "auth:lid-mapping:999111_reverse",
      encryptSecret(JSON.stringify("15555550111")),
    );
    archiveMessage({
      key: { remoteJid: lid, id: "phone-new", fromMe: true },
      message: {
        deviceSentMessage: {
          destinationJid: pn,
          message: { extendedTextMessage: { text: "Second phone reply" } },
        },
      },
      messageTimestamp: 1100,
    });
    assert.equal(canonicalJid(lid), pn);
    assert.equal(normalizeJid("15555550111:12@s.whatsapp.net"), pn);
    assert.equal(
      db
        .prepare(
          "SELECT count(*) n FROM communications WHERE direction='outbound'",
        )
        .get().n,
      2,
    );
    archiveMessage({
      key: { remoteJid: pn, id: "phone-new", fromMe: true },
      message: { conversation: "Second phone reply" },
      messageTimestamp: 1100,
    });
    assert.equal(
      db.prepare("SELECT count(*) n FROM wa_messages").get().n,
      2,
      "phone echo must not duplicate",
    );
    assert.equal(rememberIdentity(pn, "123@g.us"), false);
    db.prepare(
      "INSERT INTO wa_contacts(jid,customer_id,selected) VALUES('333222@lid',2,1)",
    ).run();
    assert.equal(
      rememberIdentity(pn, "333222@lid"),
      false,
      "different customer associations must never merge",
    );
    archiveMessage({
      key: {
        remoteJid: "333222@lid",
        remoteJidAlt: pn,
        id: "conflicting-association",
        fromMe: true,
      },
      message: { conversation: "Must stay with the actual remote contact" },
      messageTimestamp: 1150,
    });
    assert.equal(
      db
        .prepare(
          "SELECT customer_id FROM communications WHERE body='Must stay with the actual remote contact'",
        )
        .get().customer_id,
      2,
    );
    archiveMessage({
      key: { remoteJid: lid, remoteJidAlt: pn, id: "pdf", fromMe: false },
      message: {
        documentWithCaptionMessage: {
          message: {
            documentMessage: {
              url: "https://mmg.whatsapp.net/synthetic",
              directPath: "/synthetic",
              mediaKey: Buffer.alloc(32),
              fileName: "产品报价.pdf",
              mimetype: "application/pdf",
              fileLength: 12,
              caption: "For review",
            },
          },
        },
      },
      messageTimestamp: 1200,
    });
    const media = db
      .prepare("SELECT * FROM wa_messages WHERE message_key='pdf'")
      .get();
    assert.equal(media.media_name, "产品报价.pdf");
    assert.equal(media.kind, "media");
    assert.ok(media.payload_cipher.startsWith("v1."));
    assert.ok(!media.payload_cipher.includes("mmg.whatsapp.net"));
    assert.ok(decryptSecret(media.payload_cipher).length > 0);
    assert.throws(() => whatsappMediaFor(sales, media.id), /授权/);
    db.prepare(
      "INSERT INTO customer_access(customer_id,user_id) VALUES(1,2)",
    ).run();
    assert.equal(whatsappMediaFor(sales, media.id).id, media.id);
    const detail = customerDetail(admin, 1);
    assert.ok(
      detail.messages.some(
        (m) => m.wa_message_id === media.id && m.media_available,
      ),
    );
    let downloads = 0;
    const load = async () => {
      downloads++;
      return (async function* () {
        yield Buffer.from("mock pdf");
      })();
    };
    const [first, second] = await Promise.all([
      cachedWhatsAppMedia(media.id, load),
      cachedWhatsAppMedia(media.id, load),
    ]);
    assert.equal(first.toString(), "mock pdf");
    assert.deepEqual(first, second);
    assert.equal(downloads, 1);
    await cachedWhatsAppMedia(media.id, async () => {
      throw Error("must use cache while offline");
    });
    await assert.rejects(
      boundedBytes(
        (async function* () {
          yield Buffer.alloc(3);
          yield Buffer.alloc(3);
        })(),
        5,
      ),
      /超过/,
    );
    archiveMessage({
      key: { remoteJid: pn, id: "one-time", fromMe: false },
      message: {
        viewOnceMessageV2: {
          message: {
            imageMessage: {
              url: "https://mmg.whatsapp.net/secret",
              viewOnce: true,
            },
          },
        },
      },
      messageTimestamp: 1250,
    });
    const once = db
      .prepare("SELECT * FROM wa_messages WHERE message_key='one-time'")
      .get();
    assert.equal(once.payload_cipher, "");
    assert.equal(once.kind, "view-once");
    db.prepare(
      "INSERT INTO wa_messages(jid,message_key,body,kind,timestamp,raw_key) VALUES(?,'legacy','旧附件说明','media',1200,'{}')",
    ).run(pn);
    const legacy = db
      .prepare("SELECT id FROM wa_messages WHERE message_key='legacy'")
      .get();
    await assert.rejects(cachedWhatsAppMedia(legacy.id, load), /旧消息/);
    archiveMessage(
      {
        key: { remoteJid: pn, id: "legacy", fromMe: false },
        message: {
          documentMessage: {
            url: "https://mmg.whatsapp.net/synthetic",
            fileName: "recovered.pdf",
          },
        },
        messageTimestamp: 1200,
      },
      true,
    );
    assert.ok(
      db
        .prepare("SELECT payload_cipher FROM wa_messages WHERE id=?")
        .get(legacy.id).payload_cipher,
    );
    assert.throws(() => whatsappMediaUrl("http://127.0.0.1/private"), /有效/);
    assert.throws(
      () => whatsappMediaUrl("https://mmg.whatsapp.net.evil.test/a"),
      /有效/,
    );
    assert.throws(
      () => whatsappMediaUrl("https://user:secret@mmg.whatsapp.net/a"),
      /有效/,
    );
    assert.throws(
      () => whatsappMediaUrl("https://mmg.whatsapp.net:8080/a"),
      /有效/,
    );
    const calls = [],
      transport = new ConnectionAttempt();
    transport.attach(transport.generation, {
      end() {},
      fetchMessageHistory: async (...args) => {
        calls.push(args);
      },
      profilePictureUrl: async () => {
        throw Error("privacy denied");
      },
    });
    global.__crmWa = {
      transport,
      status: "connected",
      qr: "",
      error: "",
      retries: 0,
      connecting: false,
      lastSync: "",
      enabled: true,
      startedAt: 0,
      qrExpiresAt: 0,
      network: "mock",
    };
    const started = Date.now();
    await refreshWhatsAppChat(lid);
    await refreshWhatsAppChat(lid);
    assert.equal(calls.length, 1, "recent sync rate limited");
    assert.ok(calls[0][2] >= started, "on-demand timestamp uses milliseconds");
    await requestWhatsAppHistory(pn);
    assert.equal(calls[1][2], 1000000, "older history uses epoch milliseconds");
    await refreshWhatsAppAvatar(pn);
    assert.match(
      db.prepare("SELECT avatar_status FROM wa_contacts WHERE jid=?").get(pn)
        .avatar_status,
      /隐私/,
    );
    const savedFetch = global.fetch;
    const fakeAvatar = await (
      await import("sharp")
    )
      .default({
        create: { width: 32, height: 32, channels: 3, background: "#217564" },
      })
      .png()
      .toBuffer();
    let pictureReads = 0;
    transport.socket.profilePictureUrl = async () => {
      pictureReads++;
      return "https://pps.whatsapp.net/synthetic-avatar";
    };
    global.fetch = async () =>
      new Response(fakeAvatar, { headers: { "Content-Type": "image/png" } });
    try {
      db.prepare("UPDATE wa_contacts SET avatar_checked_at=0 WHERE jid=?").run(
        pn,
      );
      await refreshWhatsAppAvatar(pn);
      await refreshWhatsAppAvatar(pn);
      assert.equal(
        pictureReads,
        1,
        "avatar cache must avoid repeated platform requests",
      );
      assert.match(
        db.prepare("SELECT avatar FROM wa_contacts WHERE jid=?").get(pn).avatar,
        /^data:image\/webp;base64,/,
      );
    } finally {
      global.fetch = savedFetch;
    }
    db.prepare(
      "UPDATE wa_contacts SET avatar='data:image/webp;base64,c3ludGhldGlj' WHERE jid=?",
    ).run(pn);
    assert.ok(
      customerList(sales).find((c) => c.id === 1).avatar,
      "linked customers show available avatar",
    );
  } finally {
    global.__crmWa = undefined;
    db.close();
    global.__rehabCrmDb = undefined;
    rmSync(dir, { recursive: true, force: true });
  }
});
