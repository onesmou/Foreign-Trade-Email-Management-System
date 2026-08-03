import assert from "node:assert/strict";
import test from "node:test";
import { parseRawEmail } from "../lib/email.ts";

test("extracts contact fields from a complete email", () => {
  const parsed = parseRawEmail(`From: Maria Lopez <maria@sunrise-rehab.mx>
Date: Mon, 3 Aug 2026 10:20:00 +0800
Subject: Inquiry for electric standing bed

Hello,
Please quote 20 electric standing beds for our new rehabilitation center in Mexico.

Maria Lopez
Sunrise Rehab Center
+52 55 1234 5678`);
  assert.equal(parsed.name, "Maria Lopez");
  assert.equal(parsed.email, "maria@sunrise-rehab.mx");
  assert.equal(parsed.company, "Sunrise Rehab Center");
  assert.equal(parsed.country, "Mexico");
  assert.equal(parsed.subject, "Inquiry for electric standing bed");
  assert.match(parsed.body, /quote 20 electric standing beds/);
  assert.ok(parsed.confidence >= 90);
});
