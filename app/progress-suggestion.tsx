"use client";
import { useState } from "react";
type Suggestion = {
  id: number;
  payload: string | number | null;
  evidence_id: string | number | null;
};
export default function ProgressSuggestion({
  suggestion: s,
  customerId,
  canWrite,
  onRefresh,
  onNotify,
}: {
  suggestion: Suggestion;
  customerId: number;
  canWrite: boolean;
  onRefresh: () => void;
  onNotify: (s: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  let p: { summary?: string; next_action?: string; conflicts?: string[] };
  try {
    p = JSON.parse(String(s.payload));
  } catch {
    return null;
  }
  async function action(type: string) {
    setBusy(true);
    try {
      const r = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: type, customerId, suggestionId: s.id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onNotify(
        type === "apply"
          ? "已更新项目；跟进日期已按等待方保留或计算，请核对"
          : "已忽略此建议",
      );
      onRefresh();
    } catch (e) {
      onNotify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="v2-progress-suggestion">
      <small>新消息的进度建议 · 依据 #{s.evidence_id} · 待你确认</small>
      <p>{p.summary}</p>
      <p>建议下一步：{p.next_action}</p>
      {p.conflicts?.length ? (
        <p className="v2-error">待核对：{p.conflicts.join("；")}</p>
      ) : null}
      <div>
        <button
          disabled={!canWrite || busy || Boolean(p.conflicts?.length)}
          onClick={() => void action("apply")}
        >
          确认并更新
        </button>
        <button
          disabled={!canWrite || busy}
          onClick={() => void action("dismiss")}
        >
          忽略建议
        </button>
      </div>
    </div>
  );
}
