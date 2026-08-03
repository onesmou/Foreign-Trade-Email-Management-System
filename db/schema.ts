import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const customers = sqliteTable("customers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  company: text("company").notNull().default(""),
  country: text("country").notNull().default(""),
  customerType: text("customer_type").notNull().default("Unknown"),
  stage: text("stage").notNull().default("New lead"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_customers_stage").on(table.stage)]);

export const inquiries = sqliteTable("inquiries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  source: text("source").notNull().default("Manual import"),
  status: text("status").notNull().default("New"),
  priority: text("priority").notNull().default("Medium"),
  aiSummary: text("ai_summary").notNull().default(""),
  aiIntent: text("ai_intent").notNull().default(""),
  aiRisk: text("ai_risk").notNull().default(""),
  recommendedProduct: text("recommended_product").notNull().default(""),
  leadScore: integer("lead_score").notNull().default(0),
  confidence: integer("confidence").notNull().default(0),
  replySubject: text("reply_subject").notNull().default(""),
  draftReply: text("draft_reply").notNull().default(""),
  analysisMode: text("analysis_mode").notNull().default(""),
  receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_inquiries_customer_id").on(table.customerId),
  index("idx_inquiries_status_received").on(table.status, table.receivedAt),
]);
