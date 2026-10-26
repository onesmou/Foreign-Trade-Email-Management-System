import { assertSameOrigin, requireApiUser } from "../../../../lib/auth";
import { audit } from "../../../../lib/db";
import {
  backupScheduleStatus,
  runScheduledBackup,
  saveBackupSchedule,
} from "../../../../lib/backup-schedule";
export const runtime = "nodejs";
export async function GET() {
  const auth = await requireApiUser(["admin"]);
  if (!auth.user) return auth.response;
  return Response.json(backupScheduleStatus());
}
export async function POST(request: Request) {
  const auth = await requireApiUser(["admin"]);
  if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const d = await request.json();
    if (d.action === "run") {
      const result = await runScheduledBackup(new Date(), true);
      audit(
        auth.user.id,
        "验证每日备份",
        "backup",
        result.backupId || "",
        result.reason || "成功",
      );
      return Response.json({ ...backupScheduleStatus(), result });
    }
    if (typeof d.enabled !== "boolean")
      throw new Error("请选择是否启用自动备份");
    saveBackupSchedule(d.enabled, Number(d.hour));
    audit(
      auth.user.id,
      "设置每日备份",
      "backup",
      "",
      `${d.enabled} / Asia/Shanghai ${d.hour}:00`,
    );
    return Response.json(backupScheduleStatus());
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
}
