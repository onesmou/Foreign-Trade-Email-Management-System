import "server-only";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { ModelMessage } from "ai";
import type { SessionUser } from "./auth";
import { customerFor, validProject, type Row } from "./crm";
import { dataDirectory, getDb } from "./db";

export const CHAT_IMAGE_LIMIT = 8 * 1024 * 1024;
export const CHAT_IMAGE_COUNT = 4;
const imageId = /^[a-f0-9-]{36}$/;
export function parseChatImages(value: unknown): string[] {
  const raw = typeof value === "string" ? JSON.parse(value) : value;
  if (
    !Array.isArray(raw) ||
    raw.length > CHAT_IMAGE_COUNT ||
    raw.some((id) => typeof id !== "string" || !imageId.test(id))
  )
    throw new Error("每条对话最多4张有效图片");
  return [...new Set(raw)] as string[];
}
export function chatImageFor(
  user: SessionUser,
  id: string,
  customerId?: number,
  projectId?: number,
) {
  if (!imageId.test(id)) throw new Error("图片不存在或未获授权");
  const row = getDb()
    .prepare("SELECT * FROM chat_images WHERE id=?")
    .get(id) as Row | undefined;
  if (
    !row ||
    (customerId !== undefined && Number(row.customer_id) !== customerId) ||
    (projectId !== undefined && Number(row.project_id) !== projectId)
  )
    throw new Error("图片不存在或未获授权");
  customerFor(user, Number(row.customer_id));
  // Unsent uploads are visible only to the uploader/admin, not everyone sharing the customer.
  if (
    user.role !== "admin" &&
    Number(row.created_by) !== user.id &&
    !getDb()
      .prepare(
        "SELECT id FROM assistant_messages WHERE customer_id=? AND project_id=? AND images LIKE ?",
      )
      .get(row.customer_id, row.project_id, `%${id}%`)
  )
    throw new Error("图片尚未加入对话或未获授权");
  return row;
}
export async function saveChatImage(
  user: SessionUser,
  customerId: number,
  projectId: number,
  name: string,
  bytes: Buffer,
) {
  customerFor(user, customerId);
  if (!validProject(customerId, projectId))
    throw new Error("请选择当前客户的采购项目");
  if (!bytes.length || bytes.length > CHAT_IMAGE_LIMIT)
    throw new Error("单张图片须小于8MB");
  const image = sharp(bytes, { limitInputPixels: 40000000, animated: false });
  const meta = await image.metadata();
  if (!["jpeg", "png", "webp"].includes(meta.format || ""))
    throw new Error("仅支持真实的 JPG、PNG 或 WebP 图片，不支持SVG或动画");
  const normalized = await image
    .rotate()
    .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 })
    .toBuffer();
  const id = randomUUID(),
    storedName = `chat-${id}.webp`;
  await writeFile(
    path.join(dataDirectory(), "uploads", storedName),
    normalized,
    { mode: 0o600 },
  );
  getDb()
    .prepare(
      "INSERT INTO chat_images(id,customer_id,project_id,created_by,stored_name,original_name,mime,size) VALUES(?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      customerId,
      projectId,
      user.id,
      storedName,
      name.replace(/[\r\n]/g, "").slice(0, 200) || "粘贴图片.png",
      "image/webp",
      normalized.length,
    );
  return {
    id,
    name: name.slice(0, 200) || "粘贴图片.png",
    url: `/api/chat/images?id=${id}`,
    size: normalized.length,
  };
}
export async function chatImageBytes(row: Row) {
  if (path.basename(String(row.stored_name)) !== row.stored_name)
    throw new Error("无效的图片路径");
  return readFile(
    path.join(dataDirectory(), "uploads", String(row.stored_name)),
  );
}
export async function imageUserMessage(
  user: SessionUser,
  customerId: number,
  projectId: number,
  text: string,
  ids: string[],
): Promise<ModelMessage> {
  if (!ids.length) return { role: "user", content: text };
  const images = await Promise.all(
    ids.map(async (id) => {
      const row = chatImageFor(user, id, customerId, projectId);
      return {
        type: "image" as const,
        image: await chatImageBytes(row),
        mediaType: String(row.mime),
      };
    }),
  );
  return { role: "user", content: [{ type: "text", text }, ...images] };
}
