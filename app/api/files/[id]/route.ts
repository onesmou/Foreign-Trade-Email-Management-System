import { readFileSync } from "node:fs";
import path from "node:path";
import { requireApiUser } from "../../../../lib/auth";
import { fileAccess, type Row } from "../../../../lib/crm";
import { dataDirectory, getDb } from "../../../../lib/db";
import { whatsappMediaFor } from "../../../../lib/whatsapp-media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const a = await requireApiUser();
  if (!a.user) return a.response;
  const { id } = await params;
  if (new URL(request.url).searchParams.get("source") === "whatsapp") {
    try {
      const media = whatsappMediaFor(a.user, Number(id));
      const { downloadWhatsAppMedia } =
        await import("../../../../lib/whatsapp");
      const bytes = await downloadWhatsAppMedia(Number(id));
      return new Response(new Uint8Array(bytes), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(String(media.media_name || "WhatsApp附件"))}`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
          "Content-Security-Policy": "sandbox; default-src 'none'",
        },
      });
    } catch (e) {
      const message = (e as Error).message;
      return Response.json(
        { error: message },
        {
          status:
            message.includes("授权") || message.includes("不存在") ? 404 : 409,
        },
      );
    }
  }
  const row = getDb()
    .prepare("SELECT * FROM knowledge_files WHERE id=?")
    .get(Number(id)) as Row | undefined;
  if (!row || !fileAccess(a.user, row))
    return Response.json({ error: "文件不存在或未获授权" }, { status: 404 });
  if (
    !row.stored_name ||
    path.basename(String(row.stored_name)) !== row.stored_name
  )
    return Response.json(
      { error: "旧资料没有保存原文件，请重新上传" },
      { status: 410 },
    );
  try {
    const body = readFileSync(
      path.join(dataDirectory(), "uploads", String(row.stored_name)),
    );
    const ext = path.extname(String(row.original_name)).toLowerCase();
    const mime: Record<string, string> = {
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".txt": "text/plain; charset=utf-8",
      ".md": "text/plain; charset=utf-8",
      ".csv": "text/plain; charset=utf-8",
    };
    const inline =
      Boolean(mime[ext]) &&
      new URL(request.url).searchParams.get("download") !== "1";
    return new Response(body, {
      headers: {
        "Content-Type": mime[ext] || "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(String(row.original_name))}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy":
          "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  } catch {
    return Response.json(
      { error: "原文件缺失，请检查数据目录或恢复备份" },
      { status: 404 },
    );
  }
}
