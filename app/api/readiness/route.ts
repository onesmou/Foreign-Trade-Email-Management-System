import { requireApiUser } from "../../../lib/auth";
import { getDb } from "../../../lib/db";
import { backupScheduleStatus } from "../../../lib/backup-schedule";
import { whatsappConnected } from "../../../lib/whatsapp";
export async function GET() {
  const auth = await requireApiUser(["admin"]);
  if (!auth.user) return auth.response;
  const db = getDb();
  const count = (sql: string) =>
    Number((db.prepare(sql).get() as { n: number }).n);
  const providers = db
    .prepare(
      "SELECT p.id,p.name,p.last_test_status,(SELECT COUNT(*) FROM provider_capabilities c WHERE c.provider_id=p.id AND c.status='success') AS passed FROM ai_providers p WHERE p.enabled=1",
    )
    .all();
  return Response.json({
    providers,
    materials: count(
      "SELECT COUNT(*) n FROM knowledge_files WHERE is_current=1 AND status='ready'",
    ),
    materialsPending: count(
      "SELECT COUNT(*) n FROM knowledge_files WHERE is_current=1 AND auto_organize=1 AND organize_status!='已归类'",
    ),
    whatsapp: {
      connected: whatsappConnected(),
      selected: count("SELECT COUNT(*) n FROM wa_contacts WHERE selected=1"),
      messages: count("SELECT COUNT(*) n FROM wa_messages"),
    },
    sources: count("SELECT COUNT(*) n FROM intake_sources WHERE enabled=1"),
    submissions: count("SELECT COUNT(*) n FROM intake_submissions"),
    backup: backupScheduleStatus(),
    notice:
      "这里只检查配置和现有记录，不会调用AI、发送WhatsApp、读取客户正文或代替真机验收",
  });
}
