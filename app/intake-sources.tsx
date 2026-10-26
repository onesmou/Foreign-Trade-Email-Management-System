"use client";
import { useState, useEffect, useEffectEvent, type FormEvent } from "react";
type Source = {
  id: string;
  name: string;
  source: string;
  campaign: string;
  enabled: number;
};
async function request(body?: unknown, method = "POST") {
  const r = await fetch(
    "/api/intake-sources",
    body
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
}
export default function IntakeSources({
  onNotify,
}: {
  onNotify: (s: string) => void;
}) {
  const [sources, setSources] = useState<Source[]>([]),
    [origin, setOrigin] = useState(""),
    [secret, setSecret] = useState<{ id: string; value: string } | null>(null),
    [busy, setBusy] = useState(false),
    [phone, setPhone] = useState("");
  async function load() {
    try {
      setSources((await request()).sources);
    } catch (e) {
      onNotify((e as Error).message);
    }
  }
  const onLoad = useEffectEvent(load);
  useEffect(() => {
    const first = setTimeout(() => {
      setOrigin(location.origin);
      void onLoad();
    }, 0);
    return () => clearTimeout(first);
  }, []);
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    try {
      const d = await request(Object.fromEntries(new FormData(form)));
      setSecret({ id: d.id, value: d.secret });
      form.reset();
      await load();
      onNotify(
        "咨询入口已创建。部署到线上后，再把正式域名链接放到网站或广告里",
      );
    } catch (e) {
      onNotify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="v2-card intake-settings">
      <h2>客户来源与在线咨询</h2>
      <p>
        为网站、广告或合作渠道分别建一个入口。客户真实提交后自动建档，相同邮箱或手机号复用原档案；首次来源不被后续
        WhatsApp 沟通覆盖。
      </p>
      <form onSubmit={add}>
        <input
          name="name"
          aria-label="咨询入口标题"
          placeholder="面向客户的标题，例如 Contact RehabIntl"
          required
          maxLength={100}
        />
        <select name="source" aria-label="来源类型">
          <option value="website">网站咨询</option>
          <option value="advertisement">广告获客</option>
          <option value="referral">转介绍</option>
          <option value="other">其他渠道</option>
        </select>
        <input
          name="campaign"
          aria-label="活动名称"
          placeholder="内部活动名，例如 Google-中东广告"
          maxLength={200}
        />
        <button className="v2-button primary" disabled={busy}>
          创建咨询入口
        </button>
      </form>
      {sources.map((s) => (
        <article key={s.id}>
          <header>
            <strong>{s.name}</strong>
            <small>
              {s.source === "website"
                ? "网站"
                : s.source === "advertisement"
                  ? "广告"
                  : s.source === "referral"
                    ? "转介绍"
                    : "其他"}{" "}
              · {s.campaign || "未设置活动"}
            </small>
            <button
              className="v2-button"
              onClick={async () => {
                try {
                  await request({ id: s.id, enabled: !s.enabled }, "PATCH");
                  await load();
                } catch (e) {
                  onNotify((e as Error).message);
                }
              }}
            >
              {s.enabled ? "停用" : "启用"}
            </button>
          </header>
          <label>
            公开咨询链接
            <input
              readOnly
              value={`${origin}/inquiry/${s.id}`}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <details>
            <summary>开发者后端接入方式</summary>
            <p>
              POST {origin}/api/intake/{s.id}
              <br />
              请求头：Content-Type: application/json；x-intake-secret:
              创建时提供的专属密钥。密钥仅放在网站后端，不能写入网页前端。
            </p>
            <pre>
              {
                '{"requestId":"唯一请求ID，16-80位","name":"客户名","email":"customer@example.com","phone":"","company":"公司","message":"客户需求正文"}'
              }
            </pre>
          </details>
        </article>
      ))}
      {secret && (
        <div className="intake-secret">
          <strong>后端接入密钥 · 仅本次显示</strong>
          <p>
            普通咨询链接不需要此密钥。仅在你要对接网站后端时保存，勿发给客户。
          </p>
          <input
            aria-label="新建入口后端密钥"
            readOnly
            type="password"
            value={secret.value}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="v2-button"
            onClick={() => {
              void navigator.clipboard
                .writeText(secret.value)
                .then(() => onNotify("密钥已复制，请只保存到后端配置"));
            }}
          >
            复制密钥
          </button>
          <button className="v2-button" onClick={() => setSecret(null)}>
            关闭
          </button>
        </div>
      )}
      <details>
        <summary>WhatsApp 直接咨询入口</summary>
        <p>
          填写你的 WhatsApp
          国际号码，生成可放在网站或广告里的对话链接。点击不算客户；收到实际消息后，在“沟通
          → 待建档”确认并关联客户。
        </p>
        <input
          aria-label="企业WhatsApp国际号码"
          placeholder="例如 8613800000000"
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
        />
        {phone.length >= 7 && phone.length <= 15 && (
          <input
            readOnly
            aria-label="WhatsApp咨询链接"
            value={`https://wa.me/${phone}?text=${encodeURIComponent("Hello, I would like to inquire about your products.")}`}
            onFocus={(e) => e.target.select()}
          />
        )}
      </details>
      <small>
        本地 127.0.0.1 链接只能本机使用。上线后须使用正式 HTTPS
        域名；尚未修改你的生产网站。公开入口应搭配反向代理限流，面向大流量投放时再加验证码。
      </small>
    </section>
  );
}
