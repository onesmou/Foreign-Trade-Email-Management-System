import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { backupEnvironment,applyPendingRestore, createEncryptedBackup, listBackups, stageEncryptedRestore } from "../lib/backup-core.ts";

test("captures Docker's effective encryption secret without serializing unrelated environment",()=>{
  const value=backupEnvironment("APP_URL=https://old.example",{APP_SECRET:"DockerSecretForTestOnly",APP_URL:"https://new.example",UNRELATED_TOKEN:"never-copy"});
  assert.match(value,/APP_SECRET="DockerSecretForTestOnly"/);assert.match(value,/APP_URL="https:\/\/new.example"/);assert.doesNotMatch(value,/UNRELATED_TOKEN|never-copy/);
});

test("creates an encrypted SQLite snapshot and restores it with a rollback copy", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "rehab-crm-backup-"));
  const sourceData = path.join(root, "source-data"); const projectDir = path.join(root, "project"); const restoreData = path.join(root, "restore-data");
  mkdirSync(path.join(sourceData, "uploads"), { recursive: true }); mkdirSync(projectDir, { recursive: true }); mkdirSync(path.join(restoreData, "uploads"), { recursive: true });
  writeFileSync(path.join(sourceData, "uploads", "product.txt"), "Electric standing bed model ST-20");
  writeFileSync(path.join(sourceData, ".app-secret"), "source-app-secret");
  writeFileSync(path.join(projectDir, ".env"), "APP_SECRET=TestSecretOnlyInsideEncryptedBackup\n");
  createFixtureDatabase(path.join(sourceData, "rehabintl-crm.sqlite"), "Restored Admin");
  createFixtureDatabase(path.join(restoreData, "rehabintl-crm.sqlite"), "Old Admin");
  writeFileSync(path.join(restoreData, "uploads", "old.txt"), "old data");
  try {
    const backup = await createEncryptedBackup({ dataDir: sourceData, envContents: readFileSync(path.join(projectDir, ".env"), "utf8"), passphrase: "BackupPass2026!", retentionDays: 30, retentionCount: 5 });
    const encryptedFile = path.join(sourceData, "backups", backup.id);
    assert.equal(listBackups(sourceData).length, 1);
    assert.equal(readFileSync(encryptedFile).subarray(0, 9).toString("ascii"), "RICRMBAK1");
    assert.doesNotMatch(readFileSync(encryptedFile).toString("latin1"), /TestSecretOnlyInsideEncryptedBackup/);
    await assert.rejects(stageEncryptedRestore({ dataDir: restoreData, encryptedFile, passphrase: "WrongPassword1" }), /密码不正确|文件已损坏/);
    const staged = await stageEncryptedRestore({ dataDir: restoreData, encryptedFile, passphrase: "BackupPass2026!" });
    assert.equal(staged.restartRequired, true);
    const result = applyPendingRestore(restoreData);
    assert.ok(result?.recoveryDir);
    const restored = new DatabaseSync(path.join(restoreData, "rehabintl-crm.sqlite"));
    assert.equal(restored.prepare("SELECT name FROM users LIMIT 1").get().name, "Restored Admin"); restored.close();
    assert.equal(readFileSync(path.join(restoreData, "uploads", "product.txt"), "utf8"), "Electric standing bed model ST-20");
    assert.equal(readFileSync(path.join(restoreData, ".app-secret"), "utf8"), "source-app-secret");
    assert.equal(readFileSync(path.join(restoreData, ".env.restore"), "utf8"), "APP_SECRET=TestSecretOnlyInsideEncryptedBackup\n");
    assert.ok(existsSync(path.join(result.recoveryDir, "rehabintl-crm.sqlite")));
    assert.ok(existsSync(path.join(result.recoveryDir, "uploads", "old.txt")));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function createFixtureDatabase(file, userName) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);CREATE TABLE customers(id INTEGER PRIMARY KEY);CREATE TABLE inquiries(id INTEGER PRIMARY KEY);CREATE TABLE company_profile(id INTEGER PRIMARY KEY);CREATE TABLE ai_providers(id INTEGER PRIMARY KEY);CREATE TABLE knowledge_files(id INTEGER PRIMARY KEY);`);
  db.prepare("INSERT INTO users(id,name) VALUES(1,?)").run(userName); db.close();
}
