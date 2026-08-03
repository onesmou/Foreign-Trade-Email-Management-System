"use client";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState(""); const [loading, setLoading] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoading(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.fromEntries(form.entries())) });
    const data = await response.json() as { error?: string };
    if (response.ok) window.location.href = "/";
    else if (data.error === "NEEDS_SETUP") window.location.href = "/setup";
    else { setError(data.error || "登录失败"); setLoading(false); }
  }
  return <main className="auth-page"><section className="auth-card">
    <div className="auth-brand"><span>R</span><div><strong>RehabIntl</strong><small>客户询盘管理系统</small></div></div>
    <div className="auth-heading"><h1>欢迎回来</h1><p>登录后管理客户、邮件、公司资料和 AI 回复。</p></div>
    <form onSubmit={submit}><label>邮箱<input name="email" type="email" autoComplete="email" required placeholder="name@company.com" /></label><label>密码<input name="password" type="password" autoComplete="current-password" required placeholder="请输入密码" /></label>
      {error && <p className="form-error">{error}</p>}<button className="primary-button auth-submit" disabled={loading}>{loading ? "正在登录…" : "登录系统"}</button></form>
    <p className="auth-footnote">账号由系统管理员创建。连续输错会暂时限制登录。</p>
  </section></main>;
}
