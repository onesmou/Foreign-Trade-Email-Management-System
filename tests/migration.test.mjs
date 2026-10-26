import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrateWorkspace } from "../lib/workspace-schema.ts";
test("additive migration preserves and reuses legacy customers/inquiries", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    `CREATE TABLE users(id INTEGER PRIMARY KEY);CREATE TABLE customers(id INTEGER PRIMARY KEY);CREATE TABLE knowledge_files(id INTEGER PRIMARY KEY);CREATE TABLE inquiries(id INTEGER PRIMARY KEY,customer_id INTEGER,subject TEXT,body TEXT,body_translation TEXT,created_by INTEGER,received_at TEXT);INSERT INTO customers VALUES(11);INSERT INTO inquiries VALUES(31,11,'Existing project','Existing body','原翻译',NULL,'2026-01-01');`,
  );
  migrateWorkspace(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM projects").get().n, 1);
  assert.equal(
    db.prepare("SELECT inquiry_id FROM communications").get().inquiry_id,
    31,
  );
  db.prepare("UPDATE projects SET title='User approved title'").run();
  migrateWorkspace(db);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM communications").get().n, 1);
  assert.equal(
    db.prepare("SELECT title FROM projects").get().title,
    "User approved title",
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM inquiries").get().n, 1);
  db.close();
});
