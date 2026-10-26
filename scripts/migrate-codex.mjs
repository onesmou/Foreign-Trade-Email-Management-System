import { DatabaseSync, backup } from "node:sqlite";
import { readFileSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { migrateWorkspace } from "../lib/workspace-schema.ts";
import { inspectBundle, applyBundle } from "./lib/codex-migration.mjs";
const { values } = parseArgs({
  options: {
    bundle: { type: "string" },
    "source-root": { type: "string" },
    database: { type: "string" },
    "admin-email": { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
for (const option of ["bundle", "source-root", "database", "admin-email"])
  if (!values[option])
    throw new Error(`缺少 --${option}，默认只预览；写入需明确 --apply`);
const database = path.resolve(values.database),
  bundlePath = path.resolve(values.bundle),
  sourceRoot = path.resolve(values["source-root"]);
if (statSync(bundlePath).size > 5 * 1024 * 1024)
  throw new Error("迁移清单超过5MB");
const bundle = JSON.parse(readFileSync(bundlePath, "utf8")),
  db = new DatabaseSync(database, { readOnly: !values.apply });
db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
try {
  const user = db
    .prepare(
      "SELECT id FROM users WHERE lower(email)=lower(?) AND role='admin' AND status='active'",
    )
    .get(values["admin-email"]);
  if (!user) throw new Error("指定管理员不存在或未启用");
  const plan = inspectBundle(db, bundle, sourceRoot, user.id);
  plan.sourceRoot = sourceRoot;
  console.log(
    JSON.stringify(
      { mode: values.apply ? "apply" : "dry-run", database, ...plan.summary },
      null,
      2,
    ),
  );
  if (values.apply) {
    if (!plan.previous) {
      const checkpoints = path.join(
        path.dirname(database),
        "migration-checkpoints",
      );
      mkdirSync(checkpoints, { recursive: true });
      await backup(
        db,
        path.join(checkpoints, `before-codex-${Date.now()}.sqlite`),
      );
    }
    migrateWorkspace(db);
    const result = applyBundle(db, plan, path.dirname(database), user.id);
    console.log(JSON.stringify({ result }, null, 2));
  } else console.log("仅预览，尚未修改数据库、复制资料或调用外部AI。");
} finally {
  db.close();
}
