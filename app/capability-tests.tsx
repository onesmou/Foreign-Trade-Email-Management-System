"use client";
import { useState, useEffect } from "react";
type Result = {
  provider_id: number;
  capability: string;
  status: string;
  detail: string;
};
export default function CapabilityTests() {
  const [providers, setProviders] = useState<{ id: number; name: string }[]>(
    [],
  );
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState("");
  const [usage, setUsage] = useState<
    {
      provider: string;
      task: string;
      calls: number;
      input_tokens: number;
      output_tokens: number;
    }[]
  >([]);
  useEffect(() => {
    let live = true;
    void Promise.all([
      fetch("/api/ai/providers").then((r) => r.json()),
      fetch("/api/ai/capabilities").then((r) => r.json()),
    ]).then(([p, r]) => {
      if (live) {
        setProviders(p.providers || []);
        setResults(r.results || []);
        setUsage(r.usage || []);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  async function test(id: number, capability: string) {
    setBusy(`${id}-${capability}`);
    try {
      const r = await fetch("/api/ai/capabilities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, capability }),
      });
      const d = await r.json();
      setResults((rows) => [
        ...rows.filter(
          (t) => !(t.provider_id === id && t.capability === capability),
        ),
        {
          provider_id: id,
          capability,
          status: r.ok ? "success" : "failed",
          detail: d.error || d.detail,
        },
      ]);
    } catch (e) {
      setResults((rows) => [
        ...rows.filter(
          (t) => !(t.provider_id === id && t.capability === capability),
        ),
        {
          provider_id: id,
          capability,
          status: "failed",
          detail: (e as Error).message,
        },
      ]);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="setting-section v2-capabilities">
      <h3>分项能力检查</h3>
      <p>
        文本连通不等于工具、流式和图片可用。每次点击会向对应服务发送一条短测试请求，可能产生少量
        API 费用。
      </p>
      {providers.map((p) => (
        <div key={p.id}>
          <strong>{p.name}</strong>
          <div className="v2-capability-buttons">
            {[
              { id: "text", name: "文本" },
              { id: "stream", name: "流式" },
              { id: "tools", name: "工具" },
              { id: "structured", name: "JSON" },
              { id: "vision", name: "看图" },
            ].map((c) => {
              const result = results.find(
                (r) => r.provider_id === p.id && r.capability === c.id,
              );
              return (
                <button
                  key={c.id}
                  title={result?.detail || "未验证"}
                  disabled={Boolean(busy)}
                  onClick={() => void test(p.id, c.id)}
                >
                  {c.name}：
                  {busy === `${p.id}-${c.id}`
                    ? "测试中"
                    : result?.status === "success"
                      ? "通过"
                      : result?.status === "failed"
                        ? "失败"
                        : "未验证"}
                </button>
              );
            })}
          </div>
          <small>
            看图测试只发送系统生成的数字图片，不发送客户文件。扫描PDF、乱码资料归类及真实产品检索仍需用你指定的样例单独验收。
          </small>
        </div>
      ))}
      {usage.length > 0 && (
        <>
          <h4>调用记录（不估算未知价格）</h4>
          {usage.map((u, i) => (
            <p key={i}>
              {u.provider} · {u.task}：{u.calls} 次，输入 {u.input_tokens} /
              输出 {u.output_tokens} tokens
            </p>
          ))}
        </>
      )}
    </section>
  );
}
