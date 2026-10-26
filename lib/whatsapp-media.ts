import "server-only";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDirectory, getDb } from "./db";
import { customerFor, type Row } from "./crm";
import type { SessionUser } from "./auth";

export const WA_MEDIA_LIMIT = 50 * 1024 * 1024;
const pending = new Map<number, Promise<Buffer>>();
export function whatsappMediaFor(user: SessionUser, id: number) {
  const db = getDb(),
    row = db
      .prepare(
        "SELECT m.*,c.customer_id,c.selected FROM wa_messages m LEFT JOIN wa_contacts c ON c.jid=m.jid WHERE m.id=?",
      )
      .get(id) as Row | undefined;
  if (!row || row.kind !== "media") throw new Error("附件不存在或未获授权");
  if (user.role !== "admin") {
    if (!row.selected || !row.customer_id)
      throw new Error("附件不存在或未获授权");
    customerFor(user, Number(row.customer_id));
  }
  return row;
}
async function* chunksOf(
  stream: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
) {
  if ("getReader" in stream) {
    const reader = stream.getReader();
    let done = false;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) {
          done = true;
          break;
        }
        yield next.value;
      }
    } finally {
      if (!done) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } else yield* stream;
}
export async function boundedBytes(
  stream: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
  limit: number,
) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of chunksOf(stream)) {
    size += chunk.length;
    if (size > limit)
      throw new Error(`文件超过 ${Math.round(limit / 1024 / 1024)}MB 限制`);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function cachedWhatsAppMedia(
  id: number,
  load: (row: Row) => Promise<AsyncIterable<Uint8Array>>,
) {
  const row = getDb()
    .prepare("SELECT * FROM wa_messages WHERE id=?")
    .get(id) as Row | undefined;
  if (!row) throw new Error("附件不存在");
  if (
    row.media_stored_name &&
    path.basename(String(row.media_stored_name)) === row.media_stored_name
  ) {
    try {
      return await readFile(
        path.join(dataDirectory(), "uploads", String(row.media_stored_name)),
      );
    } catch {
      /* Try the retained platform metadata again. */
    }
  }
  if (!row.payload_cipher)
    throw new Error(
      "这条旧消息未保存附件下载信息。请同步平台历史；平台未再下发时，需要客户重新发送原文件",
    );
  if (Number(row.media_size) > WA_MEDIA_LIMIT)
    throw new Error("附件超过50MB，请在手机端下载");
  const current = pending.get(id);
  if (current) return current;
  const task = (async () => {
    const bytes = await boundedBytes(await load(row), WA_MEDIA_LIMIT);
    const name = `wa-${randomUUID()}.bin`;
    await writeFile(path.join(dataDirectory(), "uploads", name), bytes, {
      mode: 0o600,
    });
    getDb()
      .prepare(
        "UPDATE wa_messages SET media_stored_name=?,media_size=? WHERE id=?",
      )
      .run(name, bytes.length, id);
    return bytes;
  })();
  pending.set(id, task);
  try {
    return await task;
  } finally {
    pending.delete(id);
  }
}
