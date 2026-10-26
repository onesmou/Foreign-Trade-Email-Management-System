// Read-only connectivity check: no account, QR, cookies or customer data is sent.
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
const proxy =
  process.env.WA_PROXY_URL ||
  process.env.HTTPS_PROXY ||
  process.env.HTTP_PROXY ||
  "";
async function probe(name, agent) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve({ name, ...result });
    };
    const started = Date.now();
    const deadline = setTimeout(
      () => request.destroy(new Error("timeout")),
      8000,
    );
    const request = https.request(
      "https://web.whatsapp.com/",
      { method: "HEAD", agent },
      (response) => {
        response.resume();
        finish({ status: response.statusCode, ms: Date.now() - started });
      },
    );
    request.on("error", (e) =>
      finish({ error: e.code || e.message, ms: Date.now() - started }),
    );
    request.end();
  });
}
const agent =
  proxy && proxy !== "direct"
    ? proxy.startsWith("socks")
      ? new SocksProxyAgent(proxy)
      : new HttpsProxyAgent(proxy)
    : undefined;
console.log(
  JSON.stringify(
    await Promise.all([
      probe("direct", undefined),
      ...(agent ? [probe("configured_proxy", agent)] : []),
    ]),
  ),
);
