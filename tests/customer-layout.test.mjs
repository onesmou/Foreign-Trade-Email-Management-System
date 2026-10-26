import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_CUSTOMER_LAYOUT,
  parseCustomerLayout,
  responsiveCustomerLayout,
} from "../lib/customer-layout.ts";

test("customer column widths round-trip and ignore unrelated storage fields", () => {
  const layout = { customers: 28.5, detail: 35, ai: 36.5 };
  assert.deepEqual(parseCustomerLayout(JSON.stringify(layout)), layout);
  assert.deepEqual(
    parseCustomerLayout({ ...layout, extra: "ignored" }),
    layout,
  );
  assert.deepEqual(
    parseCustomerLayout(DEFAULT_CUSTOMER_LAYOUT),
    DEFAULT_CUSTOMER_LAYOUT,
  );
});

test("corrupt or collapsed desktop layout cannot hide customer panels", () => {
  for (const value of [
    null,
    "",
    "broken json",
    [],
    {},
    { customers: 22, detail: 40 },
    { customers: 0, detail: 60, ai: 40 },
    { customers: -1, detail: 61, ai: 40 },
    { customers: 100, detail: 1, ai: 1 },
    { customers: 20, detail: 30, ai: 30 },
    { customers: "22", detail: 40, ai: 38 },
    { customers: NaN, detail: 40, ai: 38 },
    { customers: Infinity, detail: 40, ai: 38 },
  ])
    assert.equal(parseCustomerLayout(value), null);
});

test("responsive layouts keep desktop preferences separate from mobile navigation", () => {
  const desktop = { customers: 30, detail: 35, ai: 35 };
  assert.deepEqual(
    responsiveCustomerLayout("desktop", true, "ai", desktop),
    desktop,
  );
  assert.deepEqual(responsiveCustomerLayout("tablet", true, "ai", desktop), {
    customers: 28,
    detail: 0,
    ai: 72,
  });
  assert.deepEqual(
    responsiveCustomerLayout("tablet", true, "customer", desktop),
    { customers: 28, detail: 72, ai: 0 },
  );
  assert.deepEqual(responsiveCustomerLayout("phone", false, "ai", desktop), {
    customers: 100,
    detail: 0,
    ai: 0,
  });
  assert.deepEqual(
    responsiveCustomerLayout("phone", true, "customer", desktop),
    { customers: 0, detail: 100, ai: 0 },
  );
  assert.deepEqual(responsiveCustomerLayout("phone", true, "ai", desktop), {
    customers: 0,
    detail: 0,
    ai: 100,
  });
  assert.deepEqual(desktop, { customers: 30, detail: 35, ai: 35 });
});
