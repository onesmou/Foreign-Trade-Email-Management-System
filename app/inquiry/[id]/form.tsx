"use client";
import { useState, useEffect, type FormEvent } from "react";
export default function InquiryForm({ id }: { id: string }) {
  const [name, setName] = useState("Contact us"),
    [token, setToken] = useState(""),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void fetch(`/api/intake/${id}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setName(d.name);
        setToken(d.token);
      })
      .catch((e) => setError(e.message));
  }, [id]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const url = new URL(location.href);
      const context = ["utm_source", "utm_medium", "utm_campaign"]
        .map((k) => `${k}=${url.searchParams.get(k) || ""}`)
        .join("; ");
      const r = await fetch(`/api/intake/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...Object.fromEntries(f),
          token,
          requestId: token.split(".")[1],
          context,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="public-inquiry">
      <section>
        <span className="public-mark">CUSTOMER INQUIRY / 客户咨询</span>
        <h1>{name}</h1>
        {done ? (
          <div role="status">
            <h2>Thank you! 感谢您的咨询</h2>
            <p>
              Your inquiry has been received. We will contact you soon.
              <br />
              我们已收到您的需求，会尽快与您联系。
            </p>
          </div>
        ) : (
          <>
            <p>
              Please leave your requirements and contact details.
              <br />
              请留下采购需求和联系方式。
            </p>
            <form onSubmit={submit}>
              <label>
                Name
                <input name="name" required maxLength={100} />
                <small>姓名</small>
              </label>
              <label>
                Company
                <input name="company" maxLength={200} />
                <small>公司（选填）</small>
              </label>
              <label>
                Email
                <input name="email" type="email" maxLength={200} />
                <small>邮箱 · 与手机号至少填写一项</small>
              </label>
              <label>
                Phone / WhatsApp
                <input
                  name="phone"
                  maxLength={30}
                  placeholder="+ country code / 国家区号"
                />
                <small>国际手机号（选填）</small>
              </label>
              <label>
                Requirements
                <textarea
                  name="message"
                  required
                  minLength={5}
                  maxLength={10000}
                  rows={6}
                />
                <small>采购产品、数量、目的地等需求</small>
              </label>
              <div className="intake-honeypot" aria-hidden="true">
                <label>
                  Website
                  <input name="website" tabIndex={-1} autoComplete="off" />
                </label>
              </div>
              <p className="public-privacy">
                Your details are used only to respond to this inquiry.
                <br />
                所填资料仅用于回应此次咨询，不会公开展示。
              </p>
              <button disabled={busy || !token}>
                {busy ? "Submitting / 正在提交…" : "Submit inquiry / 提交咨询"}
              </button>
            </form>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
      <style>{`.public-inquiry{min-height:100vh;background:#f1f6f2;padding:45px 18px;color:#234f40;font-family:Arial,sans-serif}.public-inquiry section{max-width:600px;margin:auto;background:white;padding:38px;border:1px solid #e0ebe3;border-radius:16px}.public-mark{font-size:10px;letter-spacing:2px;color:#839e8e}.public-inquiry h1{font-size:26px;margin:16px 0}.public-inquiry p{font-size:13px;line-height:1.9;color:#83978a}.public-inquiry label{display:grid;gap:6px;margin:18px 0;font-size:13px}.public-inquiry input,.public-inquiry textarea{padding:11px;border:1px solid #d7e4db;border-radius:7px;font:inherit;color:#315d48;background:white;max-width:100%}.public-inquiry small{font-size:10px;color:#8ca393}.public-inquiry button{width:100%;border:0;background:#19765d;color:white;padding:14px;border-radius:8px;cursor:pointer}.public-inquiry button:disabled{opacity:.5}.intake-honeypot{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}.public-privacy{font-size:10px!important}.public-inquiry [role=alert]{color:#ac554b}@media(max-width:600px){.public-inquiry section{padding:25px}}`}</style>
    </main>
  );
}
