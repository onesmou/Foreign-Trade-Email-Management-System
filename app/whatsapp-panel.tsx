"use client";
import { useState, useEffect, useEffectEvent, useRef } from "react";
import { MessageCircle, Link2, RefreshCw, ShieldAlert } from "lucide-react";
type Customer = { id: number; name: string; company: string; phone: string };
type State = {
  status: string;
  qr: string;
  error: string;
  lastSync: string;
  contacts: {
    jid: string;
    name: string;
    customer_id: number;
    selected: number;
  }[];
  range: { earliest: string; latest: string; total: number };
  note: string;
  startedAt: number;
  qrExpiresAt: number;
  network: string;
  retryCount: number;
  timeoutSeconds: number;
};
export default function WhatsAppPanel({
  customers,
  canManage,
  onNotify,
  onOpenCustomer,
}: {
  customers: Customer[];
  canManage: boolean;
  onNotify: (s: string) => void;
  onOpenCustomer: (id: number) => void;
}) {
  const [state, setState] = useState<State | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [customerId, setCustomerId] = useState(0);
  const [phone, setPhone] = useState("");
  const [clock, setClock] = useState(() => Date.now());
  const requestEpoch = useRef(0);
  const pendingLoad = useRef(false);
  async function load() {
    if (!canManage || pendingLoad.current) return;
    pendingLoad.current = true;
    const epoch = requestEpoch.current;
    try {
      const r = await fetch("/api/whatsapp", {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (requestEpoch.current === epoch) setState(d);
    } catch (e) {
      onNotify((e as Error).message);
    } finally {
      pendingLoad.current = false;
    }
  }
  const onLoad = useEffectEvent(load);
  useEffect(() => {
    const first = setTimeout(() => void onLoad(), 0);
    const t = setInterval(() => void onLoad(), 4000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [canManage]);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function action(data: object) {
    requestEpoch.current++;
    setBusy(true);
    try {
      const r = await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setState(d);
    } catch (e) {
      onNotify(
        (e as Error).name === "TimeoutError"
          ? "请求超过10秒，按钮已恢复。请刷新连接状态后重试。"
          : (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  if (!canManage)
    return (
      <section className="v2-card v2-wa">
        <MessageCircle />
        <h2>客户沟通</h2>
        <p>
          WhatsApp
          账号由管理员连接。已授权客户的同步消息会显示在该客户的“沟通记录”中，你可逐条查看中文翻译。
        </p>
        <button
          className="v2-button"
          onClick={() => customers[0] && onOpenCustomer(customers[0].id)}
        >
          去客户工作台
        </button>
      </section>
    );
  const labels: Record<string, string> = {
    disconnected: "未连接",
    connecting: "正在连接",
    qr: "等待扫码",
    connected: "已连接",
    reconnecting: "正在重连",
    error: "连接异常",
  };
  const attempting = ["connecting", "reconnecting"].includes(
    state?.status || "",
  );
  const elapsed = state?.startedAt
    ? Math.max(0, Math.floor((clock - state.startedAt) / 1000))
    : 0;
  const qrSeconds = state?.qrExpiresAt
    ? Math.max(0, Math.ceil((state.qrExpiresAt - clock) / 1000))
    : 0;
  const formatTime = (value?: string) => {
    if (!value) return "暂无";
    const parsed = new Date(
      value.includes("T") ? value : `${value.replace(" ", "T")}Z`,
    );
    return Number.isNaN(parsed.getTime())
      ? "暂无"
      : parsed.toLocaleString("zh-CN");
  };
  return (
    <div className="v2-wa">
      <div className="v2-card v2-wa-connect">
        <header>
          <div>
            <h2>
              <MessageCircle size={23} />
              普通 WhatsApp
            </h2>
            <p>连接后，只归档你选定的业务客户聊天。</p>
          </div>
          <span
            className={`v2-status ${state?.status === "connected" ? "ready" : ""}`}
          >
            {labels[state?.status || "disconnected"]}
          </span>
        </header>
        <div className="v2-wa-body">
          <div className="v2-wa-risk">
            <ShieldAlert size={19} />
            <p>
              使用 Baileys 非官方 WhatsApp Web
              连接，可能出现断线、历史不完整或账号受限。建议先用测试账号验证。系统不会群发或自动回复；上方回复框发送前需要你确认。
            </p>
          </div>
          <label className="v2-wa-check">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
            />
            我已了解上述限制，同意发起账号连接
          </label>
          <div className="v2-wa-buttons">
            <button
              className="v2-button primary"
              disabled={!accepted || busy || state?.status === "connected"}
              onClick={() =>
                void action({ action: "connect", riskAccepted: true })
              }
            >
              <Link2 size={16} />
              {busy
                ? "正在提交…"
                : state?.status === "qr"
                  ? "重新获取二维码"
                  : attempting || state?.status === "error"
                    ? "重新尝试连接"
                    : "获取登录二维码"}
            </button>
            {(attempting || state?.status === "qr") && (
              <button
                className="v2-button"
                disabled={busy}
                onClick={() => void action({ action: "cancel" })}
              >
                停止尝试
              </button>
            )}
            <button
              className="v2-button"
              disabled={busy}
              onClick={() => {
                if (
                  confirm(
                    "解除连接会清除连接凭据，但保留已归档客户消息。确定继续？",
                  )
                )
                  void action({ action: "disconnect" });
              }}
            >
              解除连接
            </button>
            <button className="v2-button" onClick={() => void load()}>
              <RefreshCw size={15} />
              刷新
            </button>
          </div>
          {attempting && (
            <div className="v2-wa-progress" role="status">
              <strong>正在连接 WhatsApp，等待二维码…</strong>
              <p>
                本次已等待 {elapsed} 秒；单次超过 {state?.timeoutSeconds || 25}{" "}
                秒会结束等待，失败最多自动重试3次。你可以随时停止，或点击重新尝试。
              </p>
              {Boolean(state?.retryCount) && (
                <small>自动重试：{state?.retryCount}/3</small>
              )}
            </div>
          )}
          {state?.network && (
            <p className="v2-muted">
              连接网络：{state.network}
              。代理设置只用于服务器连接，不需要在手机上填写。
            </p>
          )}
          {state?.qr && (
            <div className="v2-qr">
              <picture>
                <img
                  src={state.qr}
                  alt="WhatsApp 连接二维码"
                  width={260}
                  height={260}
                />
              </picture>
              <p>
                手机 WhatsApp → 设置 → 已关联的设备 → 关联设备，扫描上方二维码。
                {qrSeconds > 0 && (
                  <>
                    <br />
                    二维码刷新倒计时：{qrSeconds} 秒；刷新后请扫描新的码。
                  </>
                )}
              </p>
            </div>
          )}
          {state?.error && <p className="v2-error">{state.error}</p>}
          <p className="v2-muted">
            最后同步：{formatTime(state?.lastSync)}
            <br />
            实际同步 {state?.range?.total || 0} 条，范围：
            {formatTime(state?.range?.earliest)} 至{" "}
            {formatTime(state?.range?.latest)}
            。不计入手动录入的演示记录；平台下发的私聊可在上方消息区查看，关联客户后进入客户档案。不承诺全量历史。已支持人工确认后发送文字，以及单件50MB以内的附件下载；旧媒体可能过期，阅后即焚媒体不保存，暂不支持发送附件。
          </p>
        </div>
      </div>
      <section className="v2-card v2-wa-contacts">
        <header>
          <h3>关联业务客户</h3>
          <span>未选定的聊天不会建立客户档案</span>
        </header>
        <div className="v2-wa-body">
          <div className="v2-form-grid">
            <label>
              关联到 CRM 客户
              <select
                value={customerId}
                onChange={(e) => setCustomerId(Number(e.target.value))}
              >
                <option value={0}>请选择客户</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company || c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              客户 WhatsApp 号码（含国家区号）
              <input
                placeholder="例如 +971501234567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </label>
          </div>
          <button
            className="v2-button"
            disabled={!customerId || !phone || busy}
            onClick={() =>
              void action({ action: "addPhone", customerId, phone })
            }
          >
            保存号码并选择同步
          </button>
          <p className="v2-muted">
            从邮件转到 WhatsApp 时请选择同一个 CRM 客户。平台使用隐私 ID
            时，应从下方实际联系人中关联，不用号码猜测合并。
          </p>
        </div>
        {state?.contacts?.map((c) => (
          <div className="v2-wa-contact" key={c.jid}>
            <div>
              <strong>{c.name || c.jid.split("@")[0]}</strong>
              <small>{c.jid}</small>
            </div>
            {c.selected ? (
              <>
                <button onClick={() => onOpenCustomer(c.customer_id)}>
                  查看客户
                </button>
                <button
                  onClick={() =>
                    void action({
                      action: "select",
                      jid: c.jid,
                      customerId: c.customer_id,
                      selected: false,
                    })
                  }
                >
                  停止归档
                </button>
              </>
            ) : (
              <select
                aria-label={`关联 ${c.name || c.jid}`}
                value={0}
                onChange={(e) =>
                  void action({
                    action: "select",
                    jid: c.jid,
                    customerId: Number(e.target.value),
                  })
                }
              >
                <option value={0}>选择关联客户</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.company || customer.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
