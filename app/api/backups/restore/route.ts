import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertSameOrigin, requireApiUser } from "../../../../lib/auth";
import { stageEncryptedRestore } from "../../../../lib/backup-core";
import { audit, dataDirectory } from "../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireApiUser(["admin"]); if (!auth.user) return auth.response;
  let temporaryFile = "";
  try {
    assertSameOrigin(request);
    const form = await request.formData();
    const file = form.get("file"); const passphrase = String(form.get("passphrase") || ""); const confirmation = String(form.get("confirmation") || "");
    if (!(file instanceof File)) return Response.json({ error: "请选择 .ricrmbak 备份文件" }, { status: 400 });
    if (confirmation !== "确认恢复") return Response.json({ error: "请输入“确认恢复”" }, { status: 400 });
    if (file.size > 512 * 1024 * 1024) return Response.json({ error: "在线恢复文件不能超过512MB；更大的备份请在服务器上恢复" }, { status: 400 });
    temporaryFile = path.join(dataDirectory(), `.restore-upload-${randomUUID()}.ricrmbak`);
    writeFileSync(temporaryFile, Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
    const result = await stageEncryptedRestore({ dataDir: dataDirectory(), encryptedFile: temporaryFile, passphrase });
    audit(auth.user.id, "暂存加密恢复", "backup_restore", "pending", file.name);
    return Response.json({ ok: true, ...result, message: "备份已验证并暂存。请立即在宝塔中重启Node项目，恢复将在启动前自动完成。" });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "恢复失败" }, { status: 400 }); }
  finally { if (temporaryFile) try { unlinkSync(temporaryFile); } catch { /* temporary upload may not exist */ } }
}
