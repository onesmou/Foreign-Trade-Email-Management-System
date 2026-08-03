import "server-only";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { applyPendingRestore } from "./backup-core";

declare global {
  var __rehabCrmDb: DatabaseSync | undefined;
}

export function dataDirectory() {
  return process.env.DATA_DIR ? path.resolve(/*turbopackIgnore: true*/ process.env.DATA_DIR) : path.join(process.cwd(), "data");
}

export function getDb() {
  if (global.__rehabCrmDb) return global.__rehabCrmDb;
  const dir = dataDirectory();
  mkdirSync(dir, { recursive: true });
  applyPendingRestore(dir);
  mkdirSync(path.join(dir, "uploads"), { recursive: true });
  const db = new DatabaseSync(path.join(dir, "rehabintl-crm.sqlite"));
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec("PRAGMA busy_timeout=5000");
  migrate(db);
  global.__rehabCrmDb = db;
  return db;
}

function migrate(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'sales' CHECK(role IN ('admin','sales','viewer')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_agent TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS company_profile (
      id INTEGER PRIMARY KEY CHECK(id=1),
      company_name TEXT NOT NULL DEFAULT 'RehabIntl',
      brand TEXT NOT NULL DEFAULT 'RehabIntl',
      sales_email TEXT NOT NULL DEFAULT 'support@rehabintl.com',
      whatsapp TEXT NOT NULL DEFAULT '+8618506234569',
      website TEXT NOT NULL DEFAULT 'https://www.rehabintl.com/',
      business_summary TEXT NOT NULL DEFAULT '',
      sales_rules TEXT NOT NULL DEFAULT '',
      reply_signature TEXT NOT NULL DEFAULT 'Best regards,\nRehabIntl Sales Team',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      company TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT '待判断',
      stage TEXT NOT NULL DEFAULT '新线索',
      owner_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      raw_email TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      body_translation TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '整封邮件录入',
      status TEXT NOT NULL DEFAULT '待分析',
      priority TEXT NOT NULL DEFAULT '中',
      ai_summary TEXT NOT NULL DEFAULT '',
      ai_intent TEXT NOT NULL DEFAULT '',
      ai_risk TEXT NOT NULL DEFAULT '',
      recommended_product TEXT NOT NULL DEFAULT '',
      lead_score INTEGER NOT NULL DEFAULT 0,
      confidence INTEGER NOT NULL DEFAULT 0,
      reply_subject TEXT NOT NULL DEFAULT '',
      draft_reply TEXT NOT NULL DEFAULT '',
      draft_translation TEXT NOT NULL DEFAULT '',
      analysis_mode TEXT NOT NULL DEFAULT '',
      provider_id INTEGER,
      knowledge_sources TEXT NOT NULL DEFAULT '[]',
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_by INTEGER,
      updated_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(provider_id) REFERENCES ai_providers(id) ON DELETE SET NULL,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY(updated_by) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS ai_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider_key TEXT NOT NULL,
      api_style TEXT NOT NULL DEFAULT 'chat' CHECK(api_style IN ('chat','responses')),
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key_cipher TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 0,
      last_test_status TEXT NOT NULL DEFAULT 'untested',
      last_test_message TEXT NOT NULL DEFAULT '',
      last_test_at TEXT,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(created_by) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_name TEXT NOT NULL,
      source_path TEXT NOT NULL DEFAULT '',
      stored_name TEXT NOT NULL DEFAULT '',
      mime_type TEXT NOT NULL DEFAULT '',
      size_bytes INTEGER NOT NULL DEFAULT 0,
      category TEXT NOT NULL DEFAULT '其他资料',
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ready',
      chunk_count INTEGER NOT NULL DEFAULT 0,
      uploaded_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      keywords TEXT NOT NULL DEFAULT '',
      FOREIGN KEY(file_id) REFERENCES knowledge_files(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry ON sessions(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_customers_stage ON customers(stage);
    CREATE INDEX IF NOT EXISTS idx_inquiries_status_received ON inquiries(status, received_at DESC);
    CREATE INDEX IF NOT EXISTS idx_inquiries_customer ON inquiries(customer_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_files_category ON knowledge_files(category, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_file ON knowledge_chunks(file_id, chunk_index);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);
  db.prepare(`INSERT OR IGNORE INTO company_profile
    (id,company_name,brand,sales_email,whatsapp,website,business_summary,sales_rules,reply_signature)
    VALUES (1,?,?,?,?,?,?,?,?)`).run(
      "RehabIntl", "RehabIntl", "support@rehabintl.com", "+8618506234569", "https://www.rehabintl.com/",
      "面向海外诊所、经销商、进口商、养老项目、儿童康复中心提供康复医疗设备。",
      "不得凭空承诺价格、库存、交期、认证、质保或技术参数；信息不足时先向客户提问；所有回复发送前必须人工确认。",
      "Best regards,\nRehabIntl Sales Team",
    );
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
  db.exec("PRAGMA optimize");
}

export function audit(userId: number | null, action: string, entityType = "", entityId = "", detail = "", ip = "") {
  getDb().prepare("INSERT INTO audit_logs (user_id,action,entity_type,entity_id,detail,ip) VALUES (?,?,?,?,?,?)")
    .run(userId, action, entityType, entityId, detail.slice(0, 1000), ip);
}

export function rowCount(table: "users" | "inquiries" | "knowledge_files") {
  return Number((getDb().prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total);
}
