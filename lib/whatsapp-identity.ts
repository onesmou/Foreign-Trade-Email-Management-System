import "server-only";
import { getDb } from "./db";
import type { Row } from "./crm";

export function normalizeJid(jid: string) {
  return jid.replace(/:\d+(?=@(?:s\.whatsapp\.net|lid)$)/, "");
}
export function canonicalJid(jid: string) {
  const normalized = normalizeJid(jid);
  return String(
    (
      getDb()
        .prepare("SELECT jid FROM wa_aliases WHERE alias=?")
        .get(normalized) as Row | undefined
    )?.jid || normalized,
  );
}
// Only call with a PN/LID pair explicitly supplied by WhatsApp, never guessed digits/names.
export function rememberIdentity(first: string, second: string) {
  const a = normalizeJid(first),
    b = normalizeJid(second);
  if (
    !/^\d+@(s\.whatsapp\.net|lid)$/.test(a) ||
    !/^\d+@(s\.whatsapp\.net|lid)$/.test(b) ||
    a.split("@")[1] === b.split("@")[1]
  )
    return false;
  const db = getDb(),
    ca = canonicalJid(a),
    cb = canonicalJid(b);
  if (ca === cb) return true;
  const contacts = db
    .prepare("SELECT * FROM wa_contacts WHERE jid IN (?,?,?,?)")
    .all(a, b, ca, cb) as Row[];
  const customers = new Set(
    contacts.map((c) => Number(c.customer_id)).filter(Boolean),
  );
  if (customers.size > 1) return false; // Conflicting manual associations require human review.
  const target = String(
    contacts.find((c) => c.selected && c.customer_id)?.jid ||
      (a.endsWith("@s.whatsapp.net") ? a : b),
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT OR IGNORE INTO wa_contacts(jid) VALUES(?)").run(target);
    for (const source of new Set([a, b, ca, cb])) {
      if (source === target) continue;
      const c = contacts.find((c) => c.jid === source);
      if (c)
        db.prepare(
          "UPDATE wa_contacts SET name=COALESCE(NULLIF(name,''),?),customer_id=COALESCE(customer_id,?),selected=MAX(selected,?),avatar=COALESCE(NULLIF(avatar,''),?) WHERE jid=?",
        ).run(c.name, c.customer_id, c.selected, c.avatar || "", target);
      // Preserve duplicates in the original row; move nonduplicates without deleting source data.
      for (const field of [
        "payload_cipher",
        "media_name",
        "media_mime",
        "media_stored_name",
        "translation",
      ]) {
        db.prepare(
          `UPDATE wa_messages AS target SET ${field}=(SELECT source.${field} FROM wa_messages source WHERE source.jid=? AND source.message_key=target.message_key) WHERE target.jid=? AND target.${field}='' AND EXISTS(SELECT 1 FROM wa_messages source WHERE source.jid=? AND source.message_key=target.message_key)`,
        ).run(source, target, source);
      }
      db.prepare("UPDATE OR IGNORE wa_messages SET jid=? WHERE jid=?").run(
        target,
        source,
      );
      db.prepare("UPDATE wa_outbox SET jid=? WHERE jid=?").run(target, source);
      db.prepare("UPDATE wa_aliases SET jid=? WHERE jid=?").run(target, source);
      db.prepare(
        "INSERT INTO wa_aliases(alias,jid) VALUES(?,?) ON CONFLICT(alias) DO UPDATE SET jid=excluded.jid",
      ).run(source, target);
      db.prepare("UPDATE wa_contacts SET selected=0 WHERE jid=?").run(source);
    }
    db.exec("COMMIT");
    return true;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
