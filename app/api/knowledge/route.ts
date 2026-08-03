import { unlinkSync } from "node:fs";
import path from "node:path";
import { assertSameOrigin, requireApiUser } from "../../../lib/auth";
import { activeProvider, callModel, extractJson } from "../../../lib/ai";
import { audit, dataDirectory, getDb } from "../../../lib/db";
import { deleteKnowledge, ingestUpload, listKnowledge, updateKnowledgeCategory } from "../../../lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiUser(); if (!auth.user) return auth.response;
  const stats = getDb().prepare("SELECT COUNT(*) AS files,COALESCE(SUM(chunk_count),0) AS chunks,COALESCE(SUM(size_bytes),0) AS bytes FROM knowledge_files").get();
  return Response.json({ files: listKnowledge(), stats });
}

export async function POST(request: Request) {
  const auth = await requireApiUser(["admin", "sales"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    if (!files.length) return Response.json({ error: "请选择文件、文件夹或ZIP项目包" }, { status: 400 });
    const total = files.reduce((sum, file) => sum + file.size, 0);
    if (total > 100 * 1024 * 1024) return Response.json({ error: "单次上传总大小不能超过100MB" }, { status: 400 });
    const results = [];
    const errors: string[] = [];
    for (const file of files) {
      try { results.push(...await ingestUpload(file.name, Buffer.from(await file.arrayBuffer()), file.type, auth.user.id)); }
      catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : "读取失败"}`); }
    }
    if (!results.length) return Response.json({ error: errors.join("；") || "没有导入有效资料" }, { status: 400 });
    let aiClassified = false;
    const provider = activeProvider();
    if (provider && results.length <= 50) {
      try { await refineCategoriesWithAi(provider, results); aiClassified = true; } catch (error) { errors.push(`AI归类暂未完成：${error instanceof Error ? error.message : "未知错误"}`); }
    }
    audit(auth.user.id, "上传知识资料", "knowledge", results.map((item) => item.id).join(","), `导入${results.length}个文件`);
    return Response.json({ ok: true, imported: results.length, files: results, errors, aiClassified });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "上传失败" }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser(["admin", "sales"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const data = await request.json() as { id?: number; category?: string; summary?: string };
    if (!data.id || !data.category?.trim()) return Response.json({ error: "资料ID和分类不能为空" }, { status: 400 });
    updateKnowledgeCategory(Number(data.id), data.category.trim(), data.summary);
    audit(auth.user.id, "更新资料分类", "knowledge_file", String(data.id), data.category);
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "更新失败" }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  const auth = await requireApiUser(["admin", "sales"]); if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const id = Number(new URL(request.url).searchParams.get("id"));
    const storedName = deleteKnowledge(id);
    if (storedName && !storedName.includes("/") && !storedName.includes("\\")) {
      try { unlinkSync(path.join(dataDirectory(), "uploads", storedName)); } catch { /* metadata deletion still succeeds */ }
    }
    audit(auth.user.id, "删除知识资料", "knowledge_file", String(id));
    return Response.json({ ok: true });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "删除失败" }, { status: 500 }); }
}

async function refineCategoriesWithAi(provider: NonNullable<ReturnType<typeof activeProvider>>, files: Array<{ id: number; name: string; sourcePath: string; category: string; summary: string }>) {
  const sample = files.map((file) => ({ id: file.id, name: file.name, path: file.sourcePath, localCategory: file.category, excerpt: file.summary })).slice(0, 50);
  const text = await callModel(provider, [
    { role: "system", content: "你负责整理康复医疗设备外贸公司的知识库。只能从以下分类选择：产品资料、公司介绍、公司资质、报价与商务政策、销售话术、Agent / 项目文件、其他资料。返回JSON对象，格式为 {\"files\":[{\"id\":1,\"category\":\"产品资料\",\"summary\":\"中文简述\"}]}。" },
    { role: "user", content: JSON.stringify(sample) },
  ], { json: true, maxTokens: 2200 });
  const result = extractJson<{ files?: Array<{ id: number; category: string; summary: string }> }>(text);
  for (const item of result.files || []) updateKnowledgeCategory(Number(item.id), item.category, item.summary);
}
