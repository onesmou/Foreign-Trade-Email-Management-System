import { assertSameOrigin, requireApiUser } from "../../../lib/auth";
import { customerFor, fileAccess, type Row } from "../../../lib/crm";
import { audit, getDb } from "../../../lib/db";
import {
  cleanFolderName,
  ensureFolder,
  folderFor,
  listFolders,
  moveFolder,
  sameScope,
} from "../../../lib/folders";
export const runtime = "nodejs";
export async function GET() {
  const a = await requireApiUser();
  if (!a.user) return a.response;
  return Response.json({ folders: listFolders(a.user) });
}
export async function POST(request: Request) {
  const a = await requireApiUser(["admin", "sales"]);
  if (!a.user) return a.response;
  try {
    assertSameOrigin(request);
    const d = await request.json();
    const scope = String(d.scope || "company"),
      customerId = Number(d.customerId) || undefined,
      parentId = Number(d.parentId) || null;
    if (!["company", "internal", "customer"].includes(scope))
      throw new Error("范围无效");
    if (scope === "internal" && a.user.role !== "admin")
      throw new Error("内部资料仅管理员管理");
    if (scope === "customer") {
      if (!customerId) throw new Error("请选择客户");
      customerFor(a.user, customerId);
    }
    if (
      parentId &&
      !sameScope(folderFor(a.user, parentId), { scope, customerId })
    )
      throw new Error("父文件夹范围不一致");
    const id = ensureFolder(
      cleanFolderName(d.name),
      parentId,
      { scope, customerId },
      a.user.id,
    );
    audit(a.user.id, "新建资料文件夹", "folder", String(id));
    return Response.json({ id });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
export async function PATCH(request: Request) {
  const a = await requireApiUser(["admin", "sales"]);
  if (!a.user) return a.response;
  try {
    assertSameOrigin(request);
    const d = await request.json(),
      db = getDb();
    if (d.fileId) {
      const f = db
        .prepare("SELECT * FROM knowledge_files WHERE id=? AND is_current=1")
        .get(Number(d.fileId)) as Row | undefined;
      if (
        !f ||
        !fileAccess(a.user, f) ||
        (a.user.role !== "admin" && Number(f.uploaded_by) !== a.user.id)
      )
        throw new Error("资料未授权修改");
      const folder = folderFor(a.user, Number(d.folderId));
      if (
        !sameScope(folder, {
          scope: String(f.scope),
          customerId: Number(f.customer_id) || undefined,
        })
      )
        throw new Error("不能跨范围移动；请先由管理员调整共享范围");
      db.prepare(
        "UPDATE knowledge_files SET folder_id=?,manual_folder=1,organize_status='手动归档' WHERE id=?",
      ).run(folder.id, f.id);
    } else
      moveFolder(
        a.user,
        Number(d.id),
        Number(d.parentId) || null,
        String(d.name),
      );
    audit(a.user.id, "移动或重命名资料", "folder", String(d.id || d.fileId));
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
export async function DELETE(request: Request) {
  const a = await requireApiUser(["admin", "sales"]);
  if (!a.user) return a.response;
  try {
    assertSameOrigin(request);
    const id = Number(new URL(request.url).searchParams.get("id")),
      f = folderFor(a.user, id),
      db = getDb();
    if (a.user.role !== "admin" && Number(f.created_by) !== a.user.id)
      throw new Error("只能删除自己创建的文件夹");
    if (
      db.prepare("SELECT 1 FROM knowledge_folders WHERE parent_id=?").get(id) ||
      db.prepare("SELECT 1 FROM knowledge_files WHERE folder_id=?").get(id)
    )
      throw new Error("只能删除空文件夹，请先移动资料与子文件夹");
    db.prepare("DELETE FROM knowledge_folders WHERE id=?").run(id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
