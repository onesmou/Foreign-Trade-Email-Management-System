import "server-only";
import { getDb } from "./db";
import { fileAccess, type Row } from "./crm";
import type { SessionUser } from "./auth";

export type FolderScope = { scope: string; customerId?: number };
export function cleanFolderName(input: unknown) {
  const name = String(input || "")
    .normalize("NFKC")
    .trim();
  if (
    !name ||
    name.length > 100 ||
    /[\\/\u0000-\u001f]/.test(name) ||
    [".", ".."].includes(name)
  )
    throw new Error("文件夹名称不能为空、超过100字或包含斜杠");
  return name;
}
export function folderFor(user: SessionUser, id: number) {
  const row = getDb()
    .prepare("SELECT * FROM knowledge_folders WHERE id=?")
    .get(id) as Row | undefined;
  if (!row || !fileAccess(user, row)) throw new Error("文件夹不存在或未授权");
  return row;
}
export function sameScope(row: Row, scope: FolderScope) {
  return (
    row.scope === scope.scope &&
    Number(row.customer_id || 0) === Number(scope.customerId || 0)
  );
}
export function ensureFolder(
  name: string,
  parentId: number | null,
  scope: FolderScope,
  userId: number,
) {
  const db = getDb();
  name = cleanFolderName(name);
  db.prepare(
    "INSERT OR IGNORE INTO knowledge_folders(name,parent_id,scope,customer_id,created_by) VALUES(?,?,?,?,?)",
  ).run(name, parentId, scope.scope, scope.customerId || null, userId);
  return Number(
    (
      db
        .prepare(
          "SELECT id FROM knowledge_folders WHERE name=? AND COALESCE(parent_id,0)=? AND scope=? AND COALESCE(customer_id,0)=?",
        )
        .get(name, parentId || 0, scope.scope, scope.customerId || 0) as Row
    ).id,
  );
}
export function folderPath(id: number | null) {
  const parts: string[] = [],
    seen = new Set<number>();
  while (id && !seen.has(id) && parts.length < 20) {
    seen.add(id);
    const f = getDb()
      .prepare("SELECT * FROM knowledge_folders WHERE id=?")
      .get(id) as Row | undefined;
    if (!f) break;
    parts.unshift(String(f.name));
    id = Number(f.parent_id) || null;
  }
  return parts.join(" / ");
}
export function listFolders(user: SessionUser) {
  return (
    getDb()
      .prepare("SELECT * FROM knowledge_folders ORDER BY name,id")
      .all() as Row[]
  )
    .filter((f) => fileAccess(user, f))
    .map((f) => ({ ...f, path: folderPath(Number(f.id)) }));
}
export function moveFolder(
  user: SessionUser,
  id: number,
  parentId: number | null,
  name: string,
) {
  const f = folderFor(user, id);
  if (user.role !== "admin" && Number(f.created_by) !== user.id)
    throw new Error("只能修改自己创建的文件夹");
  let cursor = parentId;
  let depth = 0;
  while (cursor) {
    if (cursor === id || ++depth > 20)
      throw new Error("不能移入自身、子文件夹或超过20层");
    const parent = folderFor(user, cursor);
    if (
      !sameScope(parent, {
        scope: String(f.scope),
        customerId: Number(f.customer_id) || undefined,
      })
    )
      throw new Error("不能跨共享范围移动文件夹");
    cursor = Number(parent.parent_id) || null;
  }
  getDb()
    .prepare("UPDATE knowledge_folders SET parent_id=?,name=? WHERE id=?")
    .run(parentId, cleanFolderName(name), id);
}
