import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
function luminance(hex) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    .map((v) => parseInt(v, 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
const contrast = (a, b) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) /
  (Math.min(luminance(a), luminance(b)) + 0.05);
test("CRM reading hierarchy has readable minimum sizes and contrast without replacing pane layout", () => {
  const base = readFileSync(
      new URL("../app/workspace.css", import.meta.url),
      "utf8",
    ),
    brand = readFileSync(
      new URL("../app/company-settings.css", import.meta.url),
      "utf8",
    ),
    theme = readFileSync(
      new URL("../app/readability.css", import.meta.url),
      "utf8",
    );
  for (const text of [base, brand])
    for (const m of text.matchAll(/font-size:\s*([\d.]+)px/g))
      assert.ok(Number(m[1]) >= 12, `Small text ${m[0]}`);
  const color = (name) => {
    const match = theme.match(new RegExp(`--${name}:\\s*(#[a-f\\d]{6})`, "i"));
    assert.ok(match, `Missing ${name}`);
    return match[1];
  };
  const placeholder = theme.match(
    /::placeholder\s*\{[^}]*color:\s*(#[a-f\d]{6})/i,
  );
  assert.ok(placeholder);
  for (const fg of [
    color("v2-ink"),
    color("v2-muted"),
    color("v2-green"),
    placeholder[1],
  ])
    for (const bg of ["#ffffff", "#f7f9f7", "#eef5f1"])
      assert.ok(contrast(fg, bg) >= 4.5, `${fg} on ${bg}`);
  assert.match(theme, /font-size:\s*15px/);
  assert.match(theme, /Segoe UI/);
  assert.match(theme, /@media\s*\(max-width:\s*760px\)/);
  assert.ok(theme.includes(".v2-column-separator"));
  assert.ok(
    !/position:\s*fixed|grid-template-columns:|\.v2-column[^}]*display:\s*none/.test(
      theme,
    ),
    "readability layer must not replace draggable/fullscreen layout",
  );
});
