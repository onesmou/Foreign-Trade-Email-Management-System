import { assertSameOrigin, requireApiUser } from "../../../lib/auth";
import { audit, getDb } from "../../../lib/db";
import {
  ingestUpload,
  listKnowledge,
  updateKnowledgeCategory,
} from "../../../lib/knowledge";
import { customerFor, fileAccess, type Row } from "../../../lib/crm";
import { folderFor, listFolders, sameScope } from "../../../lib/folders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  const files = listKnowledge(auth.user);
  return Response.json({
    files,
    folders: listFolders(auth.user),
    stats: {
      files: files.length,
      chunks: files.reduce((n, f) => n + Number(f.chunk_count), 0),
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(["admin", "sales"]);
  if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const form = await request.formData();
    const scope = String(form.get("scope") || "company") as
      "company" | "internal" | "customer";
    const customerId = Number(form.get("customerId")) || undefined;
    if (!["company", "internal", "customer"].includes(scope))
      throw new Error("资料范围无效");
    if (scope === "internal" && auth.user.role !== "admin")
      throw new Error("内部资料由管理员导入");
    if (scope === "customer") {
      if (!customerId) throw new Error("请选择客户");
      customerFor(auth.user, customerId);
    }
    const folderId = Number(form.get("folderId")) || undefined;
    const autoOrganize = form.get("autoOrganize") === "true";
    if (
      folderId &&
      !sameScope(folderFor(auth.user, folderId), { scope, customerId })
    )
      throw new Error("文件夹与上传范围不一致");
    const paths = form.getAll("paths").map(String);
    const files = form
      .getAll("files")
      .filter((item): item is File => item instanceof File);
    if (!files.length)
      return Response.json(
        { error: "请选择文件、文件夹或ZIP项目包" },
        { status: 400 },
      );
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > 100 * 1024 * 1024)
      return Response.json(
        { error: "单次上传总大小不能超过100MB" },
        { status: 400 },
      );
    const results = [];
    const errors: string[] = [];
    for (const [i, file] of files.entries()) {
      try {
        results.push(
          ...(await ingestUpload(
            paths[i] || file.name,
            Buffer.from(await file.arrayBuffer()),
            file.type,
            auth.user.id,
            {
              scope,
              customerId: scope === "customer" ? customerId : undefined,
              folderId,
              autoOrganize,
            },
          )),
        );
      } catch (error) {
        errors.push(
          `${file.name}: ${error instanceof Error ? error.message : "读取失败"}`,
        );
      }
    }
    if (!results.length)
      return Response.json(
        { error: errors.join("；") || "没有导入有效资料" },
        { status: 400 },
      );
    const aiClassified = false;
    audit(
      auth.user.id,
      "上传知识资料",
      "knowledge",
      results.map((item) => item.id).join(","),
      `导入${results.length}个文件`,
    );
    return Response.json({
      ok: true,
      imported: results.length,
      files: results,
      errors,
      aiClassified,
      aiQueued: autoOrganize,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "上传失败" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser(["admin", "sales"]);
  if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const data = (await request.json()) as {
      id?: number;
      category?: string;
      summary?: string;
    };
    const file = getDb()
      .prepare("SELECT * FROM knowledge_files WHERE id=?")
      .get(Number(data.id)) as Row | undefined;
    if (
      !file ||
      !fileAccess(auth.user, file) ||
      (auth.user.role !== "admin" && Number(file.uploaded_by) !== auth.user.id)
    )
      throw new Error("资料不存在或没有修改权限");
    if (!data.id || !data.category?.trim())
      return Response.json({ error: "资料ID和分类不能为空" }, { status: 400 });
    updateKnowledgeCategory(
      Number(data.id),
      data.category.trim(),
      data.summary,
    );
    audit(
      auth.user.id,
      "更新资料分类",
      "knowledge_file",
      String(data.id),
      data.category,
    );
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "更新失败" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiUser(["admin"]);
  if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    getDb()
      .prepare("UPDATE knowledge_files SET is_current=0 WHERE id=?")
      .run(id);
    audit(auth.user.id, "删除知识资料", "knowledge_file", String(id));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "删除失败" },
      { status: 500 },
    );
  }
}
