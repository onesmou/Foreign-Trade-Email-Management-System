import { assertSameOrigin, requireApiUser } from "../../../lib/auth";
import { createEncryptedBackup, listBackups, pruneBackups, resolveBackupPath } from "../../../lib/backup-core";
import { audit, dataDirectory } from "../../../lib/db";
import { unlinkSync } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiUser(["admin"]); if (!auth.user) return auth.response;
  return Response.json({
    backups: listBackups(dataDirectory()),
    scheduleConfigured: Boolean(process.env.BACKUP_PASSPHRASE?.trim()),
    retentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 30),
    retentionCount: Number(process.env.BACKUP_RETENTION_COUNT || 30),
  });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(["admin"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const data = await request.json() as { passphrase?: string };
    const envFile = path.join(/*turbopackIgnore: true*/ process.cwd(), ".env");
    const backup = await createEncryptedBackup({
      dataDir: dataDirectory(), passphrase: data.passphrase || "", envContents: existsSync(envFile) ? readFileSync(envFile, "utf8") : "",
      retentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 30), retentionCount: Number(process.env.BACKUP_RETENTION_COUNT || 30),
    });
    audit(auth.user.id, "创建加密备份", "backup", backup.id, `${backup.size} bytes`);
    return Response.json({ ok: true, backup });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "创建备份失败" }, { status: 400 }); }
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser(["admin"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const removed = await pruneBackups(dataDirectory(), Number(process.env.BACKUP_RETENTION_DAYS || 30), Number(process.env.BACKUP_RETENTION_COUNT || 30));
    audit(auth.user.id, "清理过期备份", "backup", "", `删除${removed}个`);
    return Response.json({ ok: true, removed });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "清理失败" }, { status: 400 }); }
}

export async function DELETE(request: Request) {
  const auth = await requireApiUser(["admin"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const id = new URL(request.url).searchParams.get("id") || "";
    unlinkSync(resolveBackupPath(dataDirectory(), id));
    audit(auth.user.id, "删除本地备份", "backup", id);
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 400 }); }
}
