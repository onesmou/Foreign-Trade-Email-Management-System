import { getCurrentUser } from "../../../../lib/auth";
import { getDb, rowCount } from "../../../../lib/db";

export const dynamic = "force-dynamic";
export async function GET() {
  if (rowCount("users") === 0) return Response.json({ needsSetup: true }, { status: 409 });
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "请先登录" }, { status: 401 });
  const company = getDb().prepare("SELECT company_name,brand,sales_email,website FROM company_profile WHERE id=1").get();
  return Response.json({ user, company });
}
