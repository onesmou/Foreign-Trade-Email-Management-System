import "server-only";
import { Agent, ProxyAgent, type Dispatcher } from "undici";
import { SocksClient } from "socks";
import tls from "node:tls";
import { whatsappProxy } from "./whatsapp-connection";

let cached: { url: string; dispatcher: Dispatcher } | undefined;
// Native fetch (used by Baileys media) needs an Undici dispatcher, not an https.Agent.
export function whatsappDispatcher() {
  const { url } = whatsappProxy();
  if (!url) return undefined;
  if (cached?.url === url) return cached.dispatcher;
  if (cached) void cached.dispatcher.close();
  const proxy = new URL(url);
  const dispatcher = proxy.protocol.startsWith("http")
    ? new ProxyAgent(url)
    : new Agent({
        connect(options, callback) {
          const host = options.hostname || options.host;
          if (!host) {
            callback(new Error("代理缺少目标地址"), null);
            return;
          }
          void SocksClient.createConnection({
            proxy: {
              host: proxy.hostname,
              port: Number(proxy.port || 1080),
              type: proxy.protocol.startsWith("socks4") ? 4 : 5,
              userId: decodeURIComponent(proxy.username),
              password: decodeURIComponent(proxy.password),
            },
            command: "connect",
            destination: { host, port: Number(options.port || 443) },
            timeout: 15000,
          })
            .then(({ socket }) => {
              if (options.protocol !== "https:") {
                callback(null, socket);
                return;
              }
              const secured = tls.connect({
                socket,
                servername: host,
                rejectUnauthorized: true,
              });
              const fail = (error: Error) => {
                secured.destroy();
                callback(error, null);
              };
              secured.once("error", fail);
              secured.setTimeout(15000, () =>
                secured.destroy(new Error("代理 TLS 连接超时")),
              );
              secured.once("secureConnect", () => {
                secured.removeListener("error", fail);
                secured.setTimeout(0);
                callback(null, secured);
              });
            })
            .catch((error) => callback(error, null));
        },
      });
  cached = { url, dispatcher };
  return dispatcher;
}

export function whatsappMediaUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !["whatsapp.net", "whatsapp.com"].some((d) =>
      url.hostname.endsWith(`.${d}`),
    )
  )
    throw new Error("附件地址不是有效的 WhatsApp 媒体地址");
  return url.href;
}
