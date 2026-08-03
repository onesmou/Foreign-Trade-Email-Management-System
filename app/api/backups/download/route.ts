import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { requireApiUser } from "../../../../lib/auth";
import { resolveBackupPath } from "../../../../lib/backup-core";
import { dataDirectory } from "../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireApiUser(["admin"]); if (!auth.user) return auth.response;
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    const file = resolveBackupPath(dataDirectory(), id); const size = statSync(file).size;
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: {
      "Content-Type": "application/octet-stream", "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${id}"`, "Cache-Control": "private, no-store",
    } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "下载失败" }, { status: 404 }); }
}
