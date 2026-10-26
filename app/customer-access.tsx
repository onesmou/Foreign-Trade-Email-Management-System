"use client";
import { useState, useCallback } from "react";
type Account = { id: number; name: string; role: "admin" | "sales" | "viewer"; status: string };
export default function CustomerAccess({
  customerId,
  onNotify,
}: {
  customerId: number;
  onNotify: (s: string) => void;
}) {
  const [users, setUsers] = useState<Account[]>([]);
  const [access, setAccess] = useState<{
    owner: Account | null;
    grants: Account[];
  }>({ owner: null, grants: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);
  const load = useCallback(async () => {
    const [u, a] = await Promise.all([
      fetch("/api/users"),
      fetch(`/api/customers/access?id=${customerId}`, { cache: "no-store" }),
    ]);
    if (!u.ok || !a.ok) throw new Error("无法读取客户授权，请确认管理员身份");
    const [accounts, permissions] = await Promise.all([u.json(), a.json()]);
    setUsers(accounts.users || []);
    setAccess(permissions);
    setError("");
  }, [customerId]);
  async function change(action: string, userId = selected) {
    const account = users.find((u) => u.id === userId);
    if (
      action === "revoke" &&
      !window.confirm(
        `撤销 ${account?.name || "该账号"} 对此客户的访问权限？客户及聊天记录不会删除。`,
      )
    )
      return;
    if (
      action === "transfer" &&
      !window.confirm(
        `转交给 ${account?.name || "该账号"}？原负责人的显式授权将移除；管理员仍有全局访问权限。客户记录全部保留。`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch("/api/customers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: customerId,
          action,
          userId,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      await load();
      onNotify(
        action === "revoke"
          ? "已撤销客户授权，后续请求立即生效"
          : action === "transfer"
            ? "客户负责人已转交"
            : "已分配客户访问权限",
      );
    } catch (e) {
      onNotify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="v2-access"
      onToggle={(e) => {
        if (e.currentTarget.open)
          void load().catch((e) => setError((e as Error).message));
      }}
    >
      <summary>管理员：客户授权与转交</summary>
      {error && <p role="alert">{error}</p>}
      <p className="v2-muted">
        负责人及获授权账号可以访问，管理员始终可见。撤销不删除记录，也无法远程收回已下载文件。
      </p>
      <p>当前负责人：{access.owner?.name || "未分配"}</p>
      {access.grants
        .filter((u) => u.id !== access.owner?.id)
        .map((u) => (
          <p key={u.id}>
            {u.name} ·{" "}
            {{ admin: "管理员", sales: "销售", viewer: "只读" }[u.role] ||
              "未知角色"}
            {u.status !== "active" ? "（已停用）" : ""}{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => void change("revoke", u.id)}
            >
              撤销授权
            </button>
          </p>
        ))}
      <select
        aria-label="分配客户给账号"
        value={selected}
        disabled={busy}
        onChange={(e) => setSelected(Number(e.target.value))}
      >
        <option value={0}>选择账号</option>
        {users
          .filter((u) => u.status === "active")
          .map((u) => (
            <option value={u.id} key={u.id}>
              {u.name} ·{" "}
              {{ admin: "管理员", sales: "销售", viewer: "只读" }[u.role] ||
                "未知角色"}
            </option>
          ))}
      </select>
      <button
        className="v2-button"
        disabled={
          !selected ||
          busy ||
          users.find((u) => u.id === selected)?.role === "admin"
        }
        onClick={() => void change("grant")}
      >
        授权此客户
      </button>
      <button
        type="button"
        disabled={
          !selected ||
          busy ||
          selected === access.owner?.id ||
          users.find((u) => u.id === selected)?.role === "viewer"
        }
        onClick={() => void change("transfer")}
      >
        转交负责人
      </button>
    </details>
  );
}
