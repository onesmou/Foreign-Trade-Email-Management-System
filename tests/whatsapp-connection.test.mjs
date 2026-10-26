import assert from "node:assert/strict";
import test from "node:test";
import {
  ConnectionAttempt,
  whatsappProxy,
} from "../lib/whatsapp-connection.ts";
const pause = () => new Promise((resolve) => setTimeout(resolve, 25));
test("manual reconnect replaces a stuck socket and rejects all old attempt callbacks", async () => {
  let closed = 0;
  const transport = new ConnectionAttempt();
  const first = transport.begin();
  transport.attach(first, {
    end() {
      closed++;
    },
  });
  const second = transport.begin();
  assert.equal(closed, 1);
  assert.equal(transport.current(first), false);
  assert.equal(transport.current(second), true);
  transport.attach(second, {
    end() {
      closed++;
    },
  });
  assert.equal(transport.release(first), false);
  assert.ok(transport.socket);
  transport.close();
  assert.equal(closed, 2);
});
test("a QR deadline terminates a hung attempt and cancel clears queued retries", async () => {
  let expired = 0,
    retries = 0;
  const transport = new ConnectionAttempt();
  const id = transport.begin();
  transport.watch(id, 3, () => expired++);
  await pause();
  assert.equal(expired, 1);
  transport.schedule(id, 5, () => retries++);
  transport.close();
  await pause();
  assert.equal(retries, 0);
});
test("only the current attempt may trigger a deadline", async () => {
  let stale = 0;
  const transport = new ConnectionAttempt();
  const id = transport.begin();
  transport.watch(id, 3, () => stale++);
  transport.begin();
  await pause();
  assert.equal(stale, 0);
  transport.close();
});
test("proxy resolution uses configured routes, supports explicit direct mode and hides credentials", () => {
  assert.deepEqual(whatsappProxy({ HTTPS_PROXY: "http://127.0.0.1:7897" }), {
    url: "http://127.0.0.1:7897",
    label: "http://127.0.0.1:7897",
    source: "HTTPS_PROXY",
  });
  assert.equal(
    whatsappProxy({ WA_PROXY_URL: "direct", HTTPS_PROXY: "http://proxy.test" })
      .url,
    "",
  );
  assert.equal(
    whatsappProxy({
      NO_PROXY: ".whatsapp.com",
      HTTPS_PROXY: "http://proxy.test",
    }).url,
    "",
  );
  assert.equal(
    whatsappProxy({ HTTPS_PROXY: "http://name:secret@proxy.test:8080" }).label,
    "http://proxy.test:8080",
  );
  assert.throws(() => whatsappProxy({ WA_PROXY_URL: "file:///secret" }));
});
