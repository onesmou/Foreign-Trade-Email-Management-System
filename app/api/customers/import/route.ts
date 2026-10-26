import { parse } from "csv-parse/sync";
import { assertSameOrigin, requireApiUser } from "../../../../lib/auth";
import {
  addCommunication,
  addProject,
  findOrCreateCustomer,
} from "../../../../lib/crm";
import { audit, getDb } from "../../../../lib/db";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const a = await requireApiUser(["admin", "sales"]);
  if (!a.user) return a.response;
  try {
    assertSameOrigin(request);
    const form = await request.formData();
    const f = form.get("file");
    if (!(f instanceof File) || f.size > 5 * 1024 * 1024)
      throw new Error("请选择5MB以内的 UTF-8 CSV 文件");
    const records = parse(await f.text(), {
      columns: true,
      bom: true,
      skip_empty_lines: true,
      trim: true,
      max_record_size: 100000,
    }) as Record<string, string>[];
    if (records.length > 500) throw new Error("单次最多导入500行，请拆分文件");
    const errors: string[] = [];
    let imported = 0;
    for (const [index, r] of records.entries()) {
      try {
        const name = r.name || r.姓名 || r.联系人 || "";
        const email = r.email || r.邮箱 || "";
        const phone = r.phone || r.电话 || r.WhatsApp || "";
        if (!name && !email && !phone) throw new Error("没有姓名、邮箱或电话");
        const c = findOrCreateCustomer(a.user, {
          name,
          email,
          phone,
          company: r.company || r.公司,
          country: r.country || r.国家,
          source: r.source || r.来源 || "历史导入",
          campaign: r.campaign || r.活动,
        });
        const db = getDb();
        let projectId = Number(
          (
            db
              .prepare(
                "SELECT id FROM projects WHERE customer_id=? ORDER BY id DESC LIMIT 1",
              )
              .get(c.id) as { id: number } | undefined
          )?.id || 0,
        );
        if (!projectId)
          projectId = addProject(c.id, r.project || r.项目 || "历史采购项目");
        const body = r.message || r.沟通记录;
        if (body)
          addCommunication({
            customerId: c.id,
            projectId,
            channel: "other",
            body,
            userId: a.user.id,
          });
        imported++;
      } catch (e) {
        errors.push(`第${index + 2}行：${(e as Error).message}`);
      }
    }
    audit(
      a.user.id,
      "导入历史客户",
      "customer",
      "",
      `成功${imported}行，失败${errors.length}行`,
    );
    return Response.json({ imported, errors });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
