"use client";
import { useState, useEffect } from "react";
export default function TaskRouting() {
  const [providers, setProviders] = useState<{ id: number; name: string }[]>(
    [],
  );
  const [routes, setRoutes] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void Promise.all([
      fetch("/api/ai/providers").then((r) => r.json()),
      fetch("/api/ai/tasks").then((r) => r.json()),
    ]).then(([p, r]) => {
      if (live) {
        setProviders(p.providers || []);
        setRoutes(
          Object.fromEntries(
            (r.routes || []).map((v: { task: string; provider_id: number }) => [
              v.task,
              v.provider_id,
            ]),
          ),
        );
      }
    });
    return () => {
      live = false;
    };
  }, []);
  async function save(task: string, providerId: number) {
    try {
      const r = await fetch("/api/ai/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, providerId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setRoutes((s) => ({ ...s, [task]: providerId }));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <details className="v2-task-routing">
      <summary>高级：按任务选择服务</summary>
      <p className="v2-muted">
        默认使用当前启用模型。设置专用服务后，该任务会向你选择的服务商发送相应内容；失败不自动转给另一家。
      </p>
      {[
        { id: "chat", label: "连续对话" },
        { id: "analysis", label: "客户进度整理" },
        { id: "translation", label: "消息翻译" },
        { id: "vision", label: "图片识别" },
      ].map((t) => (
        <label key={t.id}>
          {t.label}
          <select
            value={routes[t.id] || 0}
            onChange={(e) => void save(t.id, Number(e.target.value))}
          >
            <option value={0}>使用当前启用模型</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      ))}
      {error && <p className="v2-error">{error}</p>}
    </details>
  );
}
