"use client";
import { FormEvent, useEffect, useState } from "react";

export default function SetupPage() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [requiresToken, setRequiresToken] = useState(false);
  useEffect(() => {
    fetch("/api/auth/setup")
      .then((res) => res.json())
      .then((data: { needsSetup?: boolean; requiresSetupToken?: boolean }) => {
        if (!data.needsSetup) window.location.href = "/login";
        else {
          setRequiresToken(Boolean(data.requiresSetupToken));
          setChecking(false);
        }
      });
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries()) as Record<
      string,
      string
    >;
    if (payload.password !== payload.confirmPassword) {
      setError("两次输入的密码不一致");
      setLoading(false);
      return;
    }
    const response = await fetch("/api/auth/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await response.json()) as { error?: string };
    if (response.ok) window.location.href = "/";
    else {
      setError(data.error || "初始化失败");
      setLoading(false);
    }
  }
  if (checking)
    return (
      <main className="auth-page">
        <div className="auth-loading">正在检查系统…</div>
      </main>
    );
  return (
    <main className="auth-page">
      <section className="auth-card setup-card">
        <div className="auth-brand">
          <span>R</span>
          <div>
            <strong>RehabIntl</strong>
            <small>首次使用设置</small>
          </div>
        </div>
        <div className="auth-heading">
          <h1>创建管理员</h1>
          <p>这是唯一一次开放注册。完成后只能由管理员添加用户。</p>
        </div>
        <form onSubmit={submit}>
          {requiresToken && (
            <label>
              初始化验证码
              <input
                name="setupToken"
                type="password"
                required
                autoComplete="off"
                placeholder="由部署管理员提供，仅首次创建账号时使用"
              />
            </label>
          )}
          <label>
            公司名称
            <input name="companyName" defaultValue="RehabIntl" required />
          </label>
          <label>
            管理员姓名
            <input name="name" required autoComplete="name" />
          </label>
          <label>
            管理员邮箱
            <input name="email" type="email" required autoComplete="email" />
          </label>
          <div className="auth-form-grid">
            <label>
              密码
              <input
                name="password"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
              />
            </label>
            <label>
              确认密码
              <input
                name="confirmPassword"
                type="password"
                required
                minLength={10}
                autoComplete="new-password"
              />
            </label>
          </div>
          <p className="field-tip">至少10位，并同时包含字母和数字。</p>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button auth-submit" disabled={loading}>
            {loading ? "正在创建…" : "创建管理员并进入系统"}
          </button>
        </form>
      </section>
    </main>
  );
}
