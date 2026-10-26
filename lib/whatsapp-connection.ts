// Transport lifecycle kept independent of WhatsApp/account storage for deterministic tests.
export type ClosableTransport = { end: (error?: Error) => unknown };
export class ConnectionAttempt<T extends ClosableTransport> {
  generation = 0;
  socket?: T;
  private deadline?: ReturnType<typeof setTimeout>;
  private retry?: ReturnType<typeof setTimeout>;
  begin() {
    this.close();
    return this.generation;
  }
  current(id: number) {
    return id === this.generation;
  }
  attach(id: number, socket: T) {
    if (!this.current(id)) {
      void Promise.resolve(socket.end()).catch(() => {});
      return false;
    }
    this.socket = socket;
    return true;
  }
  clearDeadline() {
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = undefined;
  }
  watch(id: number, ms: number, callback: () => void) {
    this.clearDeadline();
    this.deadline = setTimeout(() => {
      if (this.current(id)) callback();
    }, ms);
  }
  schedule(id: number, ms: number, callback: () => void) {
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => {
      this.retry = undefined;
      if (this.current(id)) callback();
    }, ms);
  }
  release(id: number) {
    if (!this.current(id)) return false;
    this.clearDeadline();
    this.socket = undefined;
    return true;
  }
  close() {
    this.generation++;
    this.clearDeadline();
    if (this.retry) clearTimeout(this.retry);
    this.retry = undefined;
    const old = this.socket;
    this.socket = undefined;
    if (old) {
      try {
        void Promise.resolve(old.end()).catch(() => {});
      } catch {
        /* already closed */
      }
    }
  }
}

export function whatsappProxy(
  env: Record<string, string | undefined> = process.env,
) {
  const explicit = env.WA_PROXY_URL?.trim();
  if (explicit === "direct")
    return { url: "", label: "直连", source: "WA_PROXY_URL" };
  const bypass = (env.NO_PROXY || env.no_proxy || "")
    .split(",")
    .map((s) => s.trim().toLowerCase());
  if (
    !explicit &&
    bypass.some(
      (s) =>
        s === "*" ||
        s === "web.whatsapp.com" ||
        s === ".whatsapp.com" ||
        s === "whatsapp.com",
    )
  )
    return { url: "", label: "直连（NO_PROXY）", source: "NO_PROXY" };
  const candidates = [
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
  ];
  const source = explicit
    ? "WA_PROXY_URL"
    : candidates.find((k) => env[k]?.trim()) || "";
  const value = explicit || (source ? env[source]?.trim() : "") || "";
  if (!value) return { url: "", label: "直连", source: "" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "WhatsApp 代理地址格式无效，请检查 WA_PROXY_URL 或系统代理环境变量",
    );
  }
  if (
    !["http:", "https:", "socks4:", "socks4a:", "socks5:", "socks5h:"].includes(
      url.protocol,
    )
  )
    throw new Error("WhatsApp 代理仅支持 HTTP、HTTPS 或 SOCKS");
  return { url: value, label: `${url.protocol}//${url.host}`, source }; // Never return embedded credentials as a label.
}
