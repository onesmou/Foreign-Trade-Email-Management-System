"use client";
import { useState, useEffect } from "react";
export default function CustomerAccess({
  customerId,
  onNotify,
}: {
  customerId: number;
  onNotify: (s: string) => void;
}) {
  const [users, setUsers] = useState<
    { id: number; name: string; role: string }[]
  >([]);
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    let live = true;
    void fetch("/api/users")
      .then((r) => r.json())
      .then((d) => {
        if (live) setUsers(d.users || []);
      });
    return () => {
      live = false;
    };
  }, []);
  async function grant() {
    try {
      const r = await fetch("/api/customers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: customerId,
          action: "grant",
          userId: selected,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onNotify("已分配此客户的访问权限。管理员可在用户设置中停用账号。");
    } catch (e) {
      onNotify((e as Error).message);
    }
  }
  return (
    <details className="v2-access">
      <summary>管理员：分配此客户</summary>
      <p className="v2-muted">
        业务员和只读用户默认只能看自己或已分配的客户。公司共享资料向已登录用户开放，内部参考只对管理员开放。
      </p>
      <select
        aria-label="分配客户给账号"
        value={selected}
        onChange={(e) => setSelected(Number(e.target.value))}
      >
        <option value={0}>选择账号</option>
        {users
          .filter((u) => u.role !== "admin")
          .map((u) => (
            <option value={u.id} key={u.id}>
              {u.name} · {u.role === "viewer" ? "只读" : "业务员"}
            </option>
          ))}
      </select>
      <button
        className="v2-button"
        disabled={!selected}
        onClick={() => void grant()}
      >
        授权此客户
      </button>
    </details>
  );
}
