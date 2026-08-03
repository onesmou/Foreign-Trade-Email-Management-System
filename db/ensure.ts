import { env } from "cloudflare:workers";

type RuntimeEnv = { DB?: D1Database };

export function getD1(): D1Database {
  const db = (env as unknown as RuntimeEnv).DB;
  if (!db) throw new Error("Customer database is not configured.");
  return db;
}

export async function ensureDatabase() {
  const db = getD1();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      company TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      customer_type TEXT NOT NULL DEFAULT 'Unknown',
      stage TEXT NOT NULL DEFAULT 'New lead',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'Manual import',
      status TEXT NOT NULL DEFAULT 'New',
      priority TEXT NOT NULL DEFAULT 'Medium',
      ai_summary TEXT NOT NULL DEFAULT '',
      ai_intent TEXT NOT NULL DEFAULT '',
      ai_risk TEXT NOT NULL DEFAULT '',
      recommended_product TEXT NOT NULL DEFAULT '',
      lead_score INTEGER NOT NULL DEFAULT 0,
      confidence INTEGER NOT NULL DEFAULT 0,
      reply_subject TEXT NOT NULL DEFAULT '',
      draft_reply TEXT NOT NULL DEFAULT '',
      analysis_mode TEXT NOT NULL DEFAULT '',
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_inquiries_customer_id ON inquiries(customer_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_inquiries_status_received ON inquiries(status, received_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_customers_stage ON customers(stage)"),
  ]);

  const count = await db.prepare("SELECT COUNT(*) AS total FROM inquiries").first<{ total: number }>();
  if (!count?.total) await seedDemoData(db);
  return db;
}

async function seedDemoData(db: D1Database) {
  await db.batch([
    db.prepare("INSERT INTO customers (name,email,company,country,customer_type,stage) VALUES (?,?,?,?,?,?)")
      .bind("Dr. Sarah Miller", "sarah@movewellclinic.de", "MoveWell Clinic", "Germany", "Clinic", "Qualified"),
    db.prepare("INSERT INTO customers (name,email,company,country,customer_type,stage) VALUES (?,?,?,?,?,?)")
      .bind("Ahmed Al-Farsi", "ahmed@medline-gulf.com", "Medline Gulf Trading", "UAE", "Distributor", "New lead"),
    db.prepare("INSERT INTO customers (name,email,company,country,customer_type,stage) VALUES (?,?,?,?,?,?)")
      .bind("Maria Santos", "maria@sunrise-rehab.ph", "Sunrise Rehabilitation Center", "Philippines", "Rehab center", "Follow-up"),
  ]);
  const rows = await db.prepare("SELECT id,email FROM customers").all<{ id: number; email: string }>();
  const ids = Object.fromEntries(rows.results.map((row) => [row.email, row.id]));
  await db.batch([
    db.prepare(`INSERT INTO inquiries (customer_id,subject,body,source,status,priority,ai_summary,ai_intent,ai_risk,recommended_product,lead_score,confidence,reply_subject,draft_reply,analysis_mode,received_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','-18 minutes'))`).bind(
        ids["sarah@movewellclinic.de"], "Quotation for gait training equipment",
        "Dear RehabIntl team, we are expanding our neurological rehabilitation department in Hamburg. Please quote one body weight support gait trainer and advise lead time, warranty and installation requirements. CE documentation is required.",
        "Email forward", "Needs reply", "High", "德国诊所扩建神经康复科，明确询价1台减重步态训练器，并关注交期、质保、安装及CE文件。", "Quotation / project purchase", "需核实具体型号、患者体重范围和CE文件版本。", "Body Weight Support Gait Trainer", 88, 94,
        "Re: Quotation for gait training equipment",
        "Dear Dr. Miller,\n\nThank you for contacting RehabIntl and for sharing the details of your neurological rehabilitation expansion. We can recommend our Body Weight Support Gait Trainer for this application.\n\nTo prepare an accurate quotation, could you please confirm the expected patient weight range, preferred training area dimensions, and whether on-site installation is required in Hamburg? We will include lead time, warranty terms, installation requirements and the available CE documentation in our proposal.\n\nBest regards,\nRehabIntl Sales Team", "Demo"
      ),
    db.prepare(`INSERT INTO inquiries (customer_id,subject,body,source,status,priority,received_at)
      VALUES (?,?,?,?,?,?,datetime('now','-2 hours'))`).bind(
        ids["ahmed@medline-gulf.com"], "Distributor cooperation in UAE",
        "Hello, we distribute medical equipment in UAE and Oman. We are looking for a rehabilitation equipment manufacturer for long-term cooperation. Please send your catalog, distributor prices, MOQ and exclusivity policy.",
        "Manual import", "New", "High"
      ),
    db.prepare(`INSERT INTO inquiries (customer_id,subject,body,source,status,priority,ai_summary,ai_intent,recommended_product,lead_score,confidence,reply_subject,draft_reply,analysis_mode,received_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now','-1 day'))`).bind(
        ids["maria@sunrise-rehab.ph"], "Follow-up: pediatric rehab room",
        "Hi, following our earlier discussion, please suggest a starter package for a small pediatric rehabilitation room. Our budget is limited and we need equipment suitable for children aged 4 to 12.",
        "Email forward", "Draft ready", "Medium", "菲律宾康复中心跟进儿童康复室项目，需要适合4–12岁、预算友好的入门配置。", "Product selection / follow-up", "Pediatric Rehabilitation starter package", 73, 90,
        "Re: Pediatric rehabilitation room starter package",
        "Dear Ms. Santos,\n\nThank you for following up. Based on the age range and the size of the planned room, we suggest starting with a compact pediatric rehabilitation package covering balance, gait, upper-limb activity and basic therapy furniture.\n\nPlease share the approximate room size and target budget range. We can then prepare a prioritized equipment list with optional items, dimensions and a consolidated quotation.\n\nBest regards,\nRehabIntl Sales Team", "Demo"
      ),
  ]);
}
