import type { DatabaseSync } from "node:sqlite";

// Additive, idempotent migration. Legacy inquiry IDs and all original records stay intact.
export function migrateWorkspace(db: DatabaseSync) {
  function column(table: string, name: string, definition: string) {
    if (
      !(
        db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
      ).some((c) => c.name === name)
    )
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  column("customers", "first_source", "TEXT NOT NULL DEFAULT '邮件'");
  column("customers", "campaign", "TEXT NOT NULL DEFAULT ''");
  column("customers", "language", "TEXT NOT NULL DEFAULT '自动识别'");
  column("knowledge_files", "scope", "TEXT NOT NULL DEFAULT 'internal'");
  column("knowledge_files", "customer_id", "INTEGER REFERENCES customers(id)");
  column("knowledge_files", "content_hash", "TEXT NOT NULL DEFAULT ''");
  column("knowledge_files", "version", "INTEGER NOT NULL DEFAULT 1");
  column("knowledge_files", "is_current", "INTEGER NOT NULL DEFAULT 1");
  column("knowledge_files", "error", "TEXT NOT NULL DEFAULT ''");
  column("knowledge_files", "folder_id", "INTEGER");
  column("knowledge_files", "auto_organize", "INTEGER NOT NULL DEFAULT 0");
  column(
    "knowledge_files",
    "organize_status",
    "TEXT NOT NULL DEFAULT '未整理'",
  );
  column("knowledge_files", "organize_reason", "TEXT NOT NULL DEFAULT ''");
  column("knowledge_files", "organize_confidence", "REAL NOT NULL DEFAULT 0");
  column("knowledge_files", "organize_provider", "TEXT NOT NULL DEFAULT ''");
  column("knowledge_files", "display_name", "TEXT NOT NULL DEFAULT ''");
  column("knowledge_files", "manual_folder", "INTEGER NOT NULL DEFAULT 0");
  column("knowledge_files", "can_send", "INTEGER NOT NULL DEFAULT 1");
  column("knowledge_files", "index_policy", "TEXT NOT NULL DEFAULT 'auto'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_imports(id TEXT PRIMARY KEY,source_system TEXT NOT NULL,thread_id TEXT NOT NULL,source_title TEXT NOT NULL,source_hash TEXT NOT NULL,customer_id INTEGER NOT NULL REFERENCES customers(id),project_id INTEGER NOT NULL REFERENCES projects(id),coverage TEXT NOT NULL,imported_by INTEGER NOT NULL REFERENCES users(id),imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(source_system,thread_id));
    CREATE TABLE IF NOT EXISTS imported_chat_items(id INTEGER PRIMARY KEY,import_id TEXT NOT NULL REFERENCES conversation_imports(id),source_item_id TEXT NOT NULL,source_turn_id TEXT NOT NULL,ordinal INTEGER NOT NULL,role TEXT NOT NULL,phase TEXT NOT NULL DEFAULT '',body TEXT NOT NULL,recorded_at TEXT NOT NULL DEFAULT '',UNIQUE(import_id,source_item_id));
    CREATE TABLE IF NOT EXISTS imported_files(import_id TEXT NOT NULL REFERENCES conversation_imports(id),file_id INTEGER NOT NULL REFERENCES knowledge_files(id),original_path TEXT NOT NULL,sha256 TEXT NOT NULL,role TEXT NOT NULL,PRIMARY KEY(import_id,file_id));
    CREATE INDEX IF NOT EXISTS idx_import_customer ON conversation_imports(customer_id,project_id);
    CREATE TABLE IF NOT EXISTS knowledge_folders(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES knowledge_folders(id),name TEXT NOT NULL,scope TEXT NOT NULL,customer_id INTEGER REFERENCES customers(id),created_by INTEGER REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS intake_sources(id TEXT PRIMARY KEY,name TEXT NOT NULL,source TEXT NOT NULL,campaign TEXT NOT NULL DEFAULT '',enabled INTEGER NOT NULL DEFAULT 1,owner_id INTEGER NOT NULL REFERENCES users(id),secret_cipher TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS intake_submissions(source_id TEXT NOT NULL REFERENCES intake_sources(id),request_id TEXT NOT NULL,customer_id INTEGER NOT NULL REFERENCES customers(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(source_id,request_id));
    CREATE TABLE IF NOT EXISTS intake_limits(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wa_messages(id INTEGER PRIMARY KEY,jid TEXT NOT NULL,message_key TEXT NOT NULL,from_me INTEGER NOT NULL DEFAULT 0,body TEXT NOT NULL,translation TEXT NOT NULL DEFAULT '',kind TEXT NOT NULL DEFAULT 'text',status TEXT NOT NULL DEFAULT 'received',timestamp INTEGER NOT NULL,raw_key TEXT NOT NULL,UNIQUE(jid,message_key));
    CREATE INDEX IF NOT EXISTS idx_wa_chat ON wa_messages(jid,timestamp,id);
    CREATE TABLE IF NOT EXISTS wa_outbox(request_id TEXT PRIMARY KEY,jid TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,message_key TEXT NOT NULL DEFAULT '',error TEXT NOT NULL DEFAULT '',created_by INTEGER NOT NULL REFERENCES users(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_folder_identity ON knowledge_folders(COALESCE(parent_id,0),name,scope,COALESCE(customer_id,0));
    CREATE TABLE IF NOT EXISTS customer_access (customer_id INTEGER NOT NULL REFERENCES customers(id), user_id INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY(customer_id,user_id));
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), title TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT '需求确认', product TEXT NOT NULL DEFAULT '', quantity TEXT NOT NULL DEFAULT '',
      destination TEXT NOT NULL DEFAULT '', waiting_on TEXT NOT NULL DEFAULT '我方', next_action TEXT NOT NULL DEFAULT '确认需求并准备回复',
      follow_up TEXT NOT NULL DEFAULT '', evidence_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS communications (
      id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), project_id INTEGER REFERENCES projects(id),
      channel TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'inbound', subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
      translation TEXT NOT NULL DEFAULT '', send_status TEXT NOT NULL DEFAULT 'received', external_id TEXT UNIQUE,
      inquiry_id INTEGER UNIQUE REFERENCES inquiries(id), created_by INTEGER REFERENCES users(id),
      occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS assistant_messages (
      id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), project_id INTEGER REFERENCES projects(id),
      role TEXT NOT NULL CHECK(role IN ('user','assistant')), content TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'complete',
      sources TEXT NOT NULL DEFAULT '[]', provider TEXT NOT NULL DEFAULT '', created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS customer_memories (
      id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), project_id INTEGER REFERENCES projects(id),
      content TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'user', evidence_id INTEGER REFERENCES communications(id),
      created_by INTEGER REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS ai_usage (
      id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id), provider TEXT NOT NULL, task TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS wa_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS progress_suggestions(id INTEGER PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(id),project_id INTEGER NOT NULL REFERENCES projects(id),evidence_id INTEGER UNIQUE REFERENCES communications(id),payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS provider_capabilities(provider_id INTEGER NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE,capability TEXT NOT NULL,status TEXT NOT NULL,detail TEXT NOT NULL DEFAULT '',tested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(provider_id,capability));
    CREATE TABLE IF NOT EXISTS ai_task_routes(task TEXT PRIMARY KEY,provider_id INTEGER NOT NULL REFERENCES ai_providers(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS wa_contacts (jid TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', customer_id INTEGER REFERENCES customers(id), selected INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_project_customer ON projects(customer_id);
    CREATE INDEX IF NOT EXISTS idx_comms_customer ON communications(customer_id,occurred_at);
    CREATE INDEX IF NOT EXISTS idx_chat_customer ON assistant_messages(customer_id,id);
    CREATE INDEX IF NOT EXISTS idx_files_scope ON knowledge_files(scope,customer_id,is_current);
  `);
  column("communications", "occurred_label", "TEXT NOT NULL DEFAULT ''");
  column("communications", "source_ref", "TEXT NOT NULL DEFAULT ''");
  column("wa_contacts", "ignored", "INTEGER NOT NULL DEFAULT 0");
  column("wa_contacts", "avatar", "TEXT NOT NULL DEFAULT ''");
  column("wa_contacts", "avatar_checked_at", "INTEGER NOT NULL DEFAULT 0");
  column("wa_contacts", "avatar_status", "TEXT NOT NULL DEFAULT ''");
  column("wa_messages", "payload_cipher", "TEXT NOT NULL DEFAULT ''");
  column("wa_messages", "media_name", "TEXT NOT NULL DEFAULT ''");
  column("wa_messages", "media_mime", "TEXT NOT NULL DEFAULT ''");
  column("wa_messages", "media_size", "INTEGER NOT NULL DEFAULT 0");
  column("wa_messages", "media_stored_name", "TEXT NOT NULL DEFAULT ''");
  column("assistant_messages", "images", "TEXT NOT NULL DEFAULT '[]'");
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_aliases(alias TEXT PRIMARY KEY,jid TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_images(id TEXT PRIMARY KEY,customer_id INTEGER NOT NULL REFERENCES customers(id),project_id INTEGER NOT NULL REFERENCES projects(id),created_by INTEGER NOT NULL REFERENCES users(id),stored_name TEXT NOT NULL,original_name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_chat_images_customer ON chat_images(customer_id,project_id);
  `);
  const unfiled = db
    .prepare(
      "SELECT DISTINCT scope,customer_id FROM knowledge_files WHERE folder_id IS NULL",
    )
    .all() as { scope: string; customer_id: number | null }[];
  for (const group of unfiled) {
    db.prepare(
      "INSERT OR IGNORE INTO knowledge_folders(name,parent_id,scope,customer_id) VALUES('待整理',NULL,?,?)",
    ).run(group.scope, group.customer_id);
    const folder = db
      .prepare(
        "SELECT id FROM knowledge_folders WHERE name='待整理' AND parent_id IS NULL AND scope=? AND COALESCE(customer_id,0)=?",
      )
      .get(group.scope, group.customer_id || 0) as { id: number };
    db.prepare(
      "UPDATE knowledge_files SET folder_id=? WHERE folder_id IS NULL AND scope=? AND COALESCE(customer_id,0)=?",
    ).run(folder.id, group.scope, group.customer_id || 0);
  }
  db.exec(
    "UPDATE wa_messages SET status='unknown' WHERE status='sending'; UPDATE wa_outbox SET status='unknown',error='服务曾中断，发送结果待确认，请先检查手机' WHERE status='sending'",
  );
  // Conservatively migrate each customer's existing inquiries into one initial project.
  db.exec(`INSERT INTO projects(customer_id,title,product,next_action)
    SELECT c.id,COALESCE((SELECT subject FROM inquiries WHERE customer_id=c.id ORDER BY id LIMIT 1),'历史询盘'),'', '查看历史并确认下一步'
    FROM customers c WHERE NOT EXISTS(SELECT 1 FROM projects p WHERE p.customer_id=c.id);
    INSERT OR IGNORE INTO communications(customer_id,project_id,channel,direction,subject,body,translation,send_status,inquiry_id,created_by,occurred_at)
    SELECT i.customer_id,(SELECT id FROM projects WHERE customer_id=i.customer_id ORDER BY id LIMIT 1),'email','inbound',i.subject,i.body,i.body_translation,'received',i.id,i.created_by,i.received_at FROM inquiries i;`);
}
