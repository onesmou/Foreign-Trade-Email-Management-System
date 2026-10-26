"use client";
import { useState, useEffect } from "react";
type Status = {
  enabled: number;
  hour: number;
  passwordConfigured: boolean;
  workerHealthy: boolean;
  last_checked_at: string;
  lastRun?: { day: string; status: string; error: string; backup_id: string };
};
export default function BackupSchedule({
  onNotify,
}: {
  onNotify: (s: string) => void;
}) {
  const [status, setStatus] = useState<Status | null>(null),
    [enabled, setEnabled] = useState(false),
    [hour, setHour] = useState(3),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/backups/schedule", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("无法读取备份任务，请刷新或重新登录");
        const d = await r.json();
        setStatus(d);
        setEnabled(Boolean(d.enabled));
        setHour(d.hour);
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError((e as Error).message);
      });
    return () => controller.abort();
  }, []);
  async function save(action?: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/backups/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action ? { action } : { enabled, hour }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setStatus(d);
      onNotify(
        action
          ? d.result?.reason || "今日加密备份已完成，请下载并异地保存"
          : "每日备份设置已保存",
      );
    } catch (error) {
      onNotify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="setting-section">
      <h3>每日加密备份</h3>
      {error && <p role="alert">{error}</p>}
      <p>
        {!status
          ? "正在读取实际任务状态…"
          : !status.passwordConfigured
            ? "未配置服务器备份密码，不能启用"
            : !status.enabled
              ? "未启用（配置了密码不等于已安排任务）"
              : status.workerHealthy
                ? "已启用，后台检查正常"
                : "已启用，但后台检查过期，请检查服务"}
      </p>
      <label>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy || !status?.passwordConfigured}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        启用每日自动备份
      </label>
      <label>
        北京时间每日执行时间
        <select
          aria-label="每日备份时间"
          value={hour}
          disabled={busy}
          onChange={(e) => setHour(Number(e.target.value))}
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")}:00
            </option>
          ))}
        </select>
      </label>
      <p>
        服务需持续运行；若当天执行时间已过，会补做一次。成功后同一天不重复；失败15分钟后重试，每日最多3次。不要同时再安排相同的宝塔计划任务。
      </p>
      <button
        type="button"
        disabled={busy || !status}
        onClick={() => void save()}
      >
        保存每日备份设置
      </button>
      <button
        type="button"
        disabled={busy || !status?.passwordConfigured}
        onClick={() => void save("run")}
      >
        立即验证一次
      </button>
      {status?.lastRun && (
        <p>
          最近任务：{status.lastRun.day} ·{" "}
          {(
            { success: "成功", failed: "失败", running: "执行中" } as Record<
              string,
              string
            >
          )[status.lastRun.status] || status.lastRun.status}
          {status.lastRun.error && ` · ${status.lastRun.error}`}
          {status.lastRun.backup_id && (
            <>
              {" "}
              ·{" "}
              <a
                href={`/api/backups/download?id=${encodeURIComponent(status.lastRun.backup_id)}`}
              >
                下载加密备份
              </a>
            </>
          )}
        </p>
      )}
      <p>
        自动备份密码使用服务器 .env 的
        BACKUP_PASSPHRASE，请私下保管。备份仅保存在本服务器，尚未自动异地保存；请下载到电脑/网盘。GitHub不是业务数据备份。
      </p>
    </section>
  );
}
