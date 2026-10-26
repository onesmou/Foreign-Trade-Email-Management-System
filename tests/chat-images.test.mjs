import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
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
test("private chat images: actual image validation, normalization, customer/project/user boundaries and multimodal history", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "crm-chat-images-"));
  process.env.DATA_DIR = dir;
  const { getDb } = await import("../lib/db.ts"),
    { saveChatImage, chatImageFor, imageUserMessage, parseChatImages } =
      await import("../lib/chat-images.ts");
  const db = getDb(),
    admin = { id: 1, role: "admin" },
    sales = { id: 2, role: "sales" };
  try {
    db.prepare(
      "INSERT INTO users(id,name,email,password_hash,role) VALUES(1,'Admin','a@example.test','none','admin'),(2,'Sales','s@example.test','none','sales')",
    ).run();
    db.prepare(
      "INSERT INTO customers(id,name,email,owner_id) VALUES(1,'A','a@customer.test',1),(2,'B','b@customer.test',2)",
    ).run();
    db.prepare(
      "INSERT INTO projects(id,customer_id,title) VALUES(1,1,'A'),(2,1,'A2'),(3,2,'B')",
    ).run();
    const bytes = await sharp({
      create: { width: 2100, height: 100, channels: 3, background: "#127560" },
    })
      .png()
      .toBuffer();
    const image = await saveChatImage(admin, 1, 1, "报价图片.png", bytes);
    assert.ok(!image.url.includes("uploads"));
    assert.equal(chatImageFor(admin, image.id).mime, "image/webp");
    const message = await imageUserMessage(admin, 1, 1, "请看这张图片", [
      image.id,
    ]);
    assert.equal(message.content[1].type, "image");
    assert.ok(Buffer.isBuffer(message.content[1].image));
    const meta = await sharp(message.content[1].image).metadata();
    assert.equal(meta.format, "webp");
    assert.equal(meta.width, 1600);
    assert.throws(() => chatImageFor(sales, image.id), /授权/);
    await assert.rejects(
      imageUserMessage(admin, 1, 2, "Cross project", [image.id]),
      /授权/,
    );
    await assert.rejects(
      imageUserMessage(admin, 2, 3, "Cross customer", [image.id]),
      /授权/,
    );
    await assert.rejects(
      saveChatImage(admin, 1, 1, "fake.png", Buffer.from("<svg/>")),
    );
    await assert.rejects(
      saveChatImage(admin, 1, 1, "huge.png", Buffer.alloc(8 * 1024 * 1024 + 1)),
      /8MB/,
    );
    await assert.rejects(
      saveChatImage(admin, 2, 1, "wrong-project.png", bytes),
      /项目/,
    );
    assert.throws(() => parseChatImages(["../../secret"]), /有效/);
    assert.throws(() => parseChatImages(Array(5).fill(image.id)), /最多4/);
    assert.deepEqual(parseChatImages([image.id, image.id]), [image.id]);
    db.prepare("INSERT INTO customer_access VALUES(1,2)").run();
    assert.throws(
      () => chatImageFor(sales, image.id),
      /尚未加入/,
      "another user must not see unsent uploads",
    );
    db.prepare(
      "INSERT INTO assistant_messages(customer_id,project_id,role,content,images,created_by) VALUES(1,1,'user','已提交',?,1)",
    ).run(JSON.stringify([image.id]));
    assert.equal(
      chatImageFor(sales, image.id).id,
      image.id,
      "shared customer may view submitted images",
    );
    await imageUserMessage(sales, 1, 1, "follow up", [image.id]);
  } finally {
    db.close();
    global.__rehabCrmDb = undefined;
    rmSync(dir, { recursive: true, force: true });
  }
});
