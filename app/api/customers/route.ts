import { assertSameOrigin, requireApiUser } from "../../../lib/auth";
import {
  addCommunication,
  addProject,
  customerDetail,
  customerFor,
  customerList,
  findOrCreateCustomer,
  stages,
  validProject,
} from "../../../lib/crm";
import { audit, getDb } from "../../../lib/db";
import { parseRawEmail } from "../../../lib/email";
import { changeCustomerAccess } from "../../../lib/customer-permissions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const a = await requireApiUser();
  if (!a.user) return a.response;
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    return Response.json(
      id
        ? customerDetail(a.user, id)
        : { customers: customerList(a.user), stages },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
export async function POST(request: Request) {
  const a = await requireApiUser(["admin", "sales"]);
  if (!a.user) return a.response;
  try {
    assertSameOrigin(request);
    const d = await request.json();
    const raw = String(d.raw || "");
    if (!raw.trim() && !d.name) throw new Error("请粘贴咨询或填写客户姓名");
    const p = parseRawEmail(raw);
    const channel = [
      "email",
      "whatsapp",
      "website",
      "advertisement",
      "exhibition",
      "referral",
      "other",
    ].includes(d.channel)
      ? d.channel
      : "email";
    const { id, existing } = d.customerId
      ? { id: Number(d.customerId), existing: true }
      : findOrCreateCustomer(a.user, {
          name: d.name || p.name,
          email: d.email || p.email,
          phone: d.phone || p.phone,
          company: d.company || p.company,
          country: d.country || p.country,
          source: d.source || channel,
          campaign: d.campaign,
        });
    customerFor(a.user, id);
    const db = getDb();
    let projectId = Number(d.projectId || 0);
    if (projectId && !validProject(id, projectId))
      throw new Error("项目不属于此客户");
    if (!projectId && !d.newProject)
      projectId = Number(
        (
          db
            .prepare(
              "SELECT id FROM projects WHERE customer_id=? ORDER BY id DESC LIMIT 1",
            )
            .get(id) as { id: number } | undefined
        )?.id || 0,
      );
    if (!projectId)
      projectId = addProject(
        id,
        d.projectTitle || d.subject || p.subject || "待确认采购需求",
      );
    if (raw.trim())
      addCommunication({
        customerId: id,
        projectId,
        channel,
        subject: d.subject || p.subject,
        body: d.body || p.body || raw,
        userId: a.user.id,
      });
    audit(
      a.user.id,
      "录入客户沟通",
      "customer",
      String(id),
      existing ? "复用原客户" : "新建客户",
    );
    return Response.json(
      { id, existing, ...customerDetail(a.user, id) },
      { status: 201 },
    );
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
export async function PATCH(request: Request) {
  const a = await requireApiUser(["admin", "sales"]);
  if (!a.user) return a.response;
  try {
    assertSameOrigin(request);
    const d = await request.json();
    const id = Number(d.id);
    customerFor(a.user, id);
    const db = getDb();
    if (d.action === "project") {
      const p = validProject(id, Number(d.projectId));
      if (!p) throw new Error("项目不存在");
      const stage = d.stage || p.stage;
      if (!stages.includes(stage)) throw new Error("阶段无效");
      const followDays = Number(d.follow_up_days ?? p.follow_up_days);
      if (!Number.isInteger(followDays) || followDays < 0 || followDays > 90)
        throw new Error("自动跟进天数需为0到90，0代表不自动设置日期");
      db.prepare(
        "UPDATE projects SET title=?,stage=?,product=?,quantity=?,destination=?,waiting_on=?,next_action=?,follow_up=?,auto_progress=?,follow_up_days=?,progress_revision=progress_revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(
        String(d.title ?? p.title).slice(0, 160),
        stage,
        String(d.product ?? p.product).slice(0, 1000),
        String(d.quantity ?? p.quantity).slice(0, 100),
        String(d.destination ?? p.destination).slice(0, 200),
        String(d.waiting_on ?? p.waiting_on).slice(0, 40),
        String(d.next_action ?? p.next_action).slice(0, 2000),
        String(d.follow_up ?? p.follow_up).slice(0, 30),
        d.auto_progress === undefined
          ? p.auto_progress
          : [true, 1, "1", "true", "on"].includes(d.auto_progress)
            ? 1
            : 0,
        followDays,
        p.id,
      );
      db.prepare(
        "UPDATE progress_suggestions SET status='superseded' WHERE project_id=? AND status='pending'",
      ).run(p.id);
    } else if (d.action === "newProject")
      addProject(id, String(d.title || "新采购项目"));
    else if (d.action === "memory") {
      if (!String(d.content || "").trim()) throw new Error("请输入记忆内容");
      db.prepare(
        "INSERT INTO customer_memories(customer_id,project_id,content,kind,created_by) VALUES(?,?,?,'user',?)",
      ).run(
        id,
        d.projectId && validProject(id, Number(d.projectId))
          ? Number(d.projectId)
          : null,
        String(d.content).slice(0, 5000),
        a.user.id,
      );
    } else if (d.action === "deleteMemory")
      db.prepare(
        "DELETE FROM customer_memories WHERE id=? AND customer_id=?",
      ).run(Number(d.memoryId), id);
    else if (["grant", "revoke", "transfer"].includes(d.action)) {
      if (a.user.role !== "admin") throw new Error("仅管理员可分配客户");
      changeCustomerAccess(id, Number(d.userId), d.action);
    } else throw new Error("未知操作");
    audit(a.user.id, "更新客户工作台", "customer", String(id), d.action);
    return Response.json(customerDetail(a.user, id));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
