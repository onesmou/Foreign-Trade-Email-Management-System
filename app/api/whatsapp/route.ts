import { assertSameOrigin, requireApiUser } from "../../../lib/auth";
import { customerFor } from "../../../lib/crm";
import { audit } from "../../../lib/db";
import {
  addPhoneContact,
  connectWhatsApp,
  disconnectWhatsApp,
  selectContact,
  whatsappStatus,
  cancelWhatsApp,
} from "../../../lib/whatsapp";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const a = await requireApiUser(["admin"]);
  if (!a.user) return a.response;
  return Response.json(whatsappStatus());
}
export async function POST(request: Request) {
  const a = await requireApiUser(["admin"]);
  if (!a.user) return a.response;
  try {
    assertSameOrigin(request);
    const d = await request.json();
    if (d.action === "connect") {
      if (d.riskAccepted !== true)
        throw new Error("请先阅读并确认非官方接入的风险说明");
      await connectWhatsApp({ restart: true });
    } else if (d.action === "cancel") cancelWhatsApp();
    else if (d.action === "disconnect") await disconnectWhatsApp();
    else if (d.action === "select") {
      customerFor(a.user, Number(d.customerId));
      selectContact(String(d.jid), Number(d.customerId), d.selected !== false);
    } else if (d.action === "addPhone") {
      customerFor(a.user, Number(d.customerId));
      const jid = addPhoneContact(String(d.phone), String(d.name || ""));
      selectContact(jid, Number(d.customerId), true);
    } else throw new Error("未知操作");
    audit(a.user.id, "WhatsApp配置", "whatsapp", "1", d.action);
    return Response.json(whatsappStatus());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
