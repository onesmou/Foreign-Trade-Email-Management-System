import "server-only";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getDb, dataDirectory } from "./db";
import { backupEnvironment, createEncryptedBackup } from "./backup-core";
type Schedule = { enabled: number; hour: number; last_checked_at: string };
type Job = {
  day: string;
  status: string;
  attempts: number;
  last_attempt_at: string;
  backup_id: string;
  error: string;
};
function configured() {
  const p = process.env.BACKUP_PASSPHRASE || "";
  return p.length >= 12 && /[A-Za-z]/.test(p) && /\d/.test(p);
}
export function backupScheduleStatus() {
  const schedule = getDb()
    .prepare(
      "SELECT enabled,hour,last_checked_at FROM backup_schedule WHERE id=1",
    )
    .get() as Schedule;
  return {
    ...schedule,
    timezone: "Asia/Shanghai",
    passwordConfigured: configured(),
    workerHealthy: Date.now() - Date.parse(schedule.last_checked_at) < 180000,
    lastRun: getDb()
      .prepare("SELECT * FROM backup_jobs ORDER BY day DESC LIMIT 1")
      .get() as Job | undefined,
    offsite: "not_configured",
  };
}
export function saveBackupSchedule(enabled: boolean, hour: number) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23)
    throw new Error("备份时间应为0到23点");
  if (enabled && !configured())
    throw new Error(
      "请先在服务器 .env 配置至少12位、含字母和数字的 BACKUP_PASSPHRASE，并重启服务",
    );
  getDb()
    .prepare(
      "UPDATE backup_schedule SET enabled=?,hour=?,updated_at=CURRENT_TIMESTAMP WHERE id=1",
    )
    .run(enabled ? 1 : 0, hour);
}
export async function runScheduledBackup(
  now = new Date(),
  force = false,
  create = createEncryptedBackup,
) {
  const db = getDb();
  db.prepare("UPDATE backup_schedule SET last_checked_at=? WHERE id=1").run(
    now.toISOString(),
  );
  const config = db
    .prepare("SELECT enabled,hour FROM backup_schedule WHERE id=1")
    .get() as Schedule;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (key: string) => parts.find((p) => p.type === key)!.value;
  const day = `${value("year")}-${value("month")}-${value("day")}`;
  if (!force && (!config.enabled || Number(value("hour")) < config.hour))
    return { skipped: true, reason: "未启用或未到执行时间" };
  if (!configured()) {
    if (force) throw new Error("自动备份密码尚未配置");
    return { skipped: true, reason: "密码未配置" };
  }
  if (!(db.prepare("SELECT COUNT(*) n FROM users").get() as { n: number }).n)
    return { skipped: true, reason: "请先初始化管理员" };
  db.exec("BEGIN IMMEDIATE");
  try {
    const job = db.prepare("SELECT * FROM backup_jobs WHERE day=?").get(day) as
      Job | undefined;
    const age = job
      ? now.getTime() - Date.parse(job.last_attempt_at)
      : Infinity;
    if (
      job &&
      (job.status === "success" ||
        (job.status === "running" && age < 6 * 3600000) ||
        (job.status === "failed" && (job.attempts >= 3 || age < 15 * 60000)))
    ) {
      db.exec("COMMIT");
      return {
        skipped: true,
        reason:
          job.status === "success"
            ? "今日已完成，不重复备份"
            : "任务正在执行或等待重试",
      };
    }
    db.prepare(
      "INSERT INTO backup_jobs(day,status,last_attempt_at) VALUES(?,'running',?) ON CONFLICT(day) DO UPDATE SET status='running',attempts=backup_jobs.attempts+1,last_attempt_at=excluded.last_attempt_at,error='' ",
    ).run(day, now.toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  try {
    const envFile = path.join(/*turbopackIgnore: true*/ process.cwd(), ".env");
    const backup = await create({
      dataDir: dataDirectory(),
      passphrase: process.env.BACKUP_PASSPHRASE!,
      envContents: backupEnvironment(
        existsSync(envFile) ? readFileSync(envFile, "utf8") : "",
      ),
      retentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 30),
      retentionCount: Number(process.env.BACKUP_RETENTION_COUNT || 30),
    });
    db.prepare(
      "UPDATE backup_jobs SET status='success',backup_id=?,error='' WHERE day=?",
    ).run(backup.id, day);
    return { skipped: false, backupId: backup.id };
  } catch {
    db.prepare(
      "UPDATE backup_jobs SET status='failed',error='备份失败，请检查服务器磁盘、目录权限及备份密码；15分钟后重试，每日最多3次' WHERE day=?",
    ).run(day);
    throw new Error("自动备份失败，请检查备份状态；未将任何资料上传第三方");
  }
}
let started = false;
let busy = false;
export function startBackupScheduler() {
  if (started) return;
  started = true;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runScheduledBackup();
    } catch {
      /* Persisted in backup_jobs, no secret logging. */
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), 60000);
  timer.unref();
  void tick();
}
