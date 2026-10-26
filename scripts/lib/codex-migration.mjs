import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  readFileSync,
  realpathSync,
  statSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import path from "node:path";

const hash = (data) => createHash("sha256").update(data).digest("hex");
const phone = (s) =>
  String(s || "")
    .replace(/\D/g, "")
    .replace(/^00/, "");
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};
function text(value, max = 100000) {
  check(
    typeof value === "string" && value.length <= max,
    "导入文本字段无效或过长",
  );
  return value;
}
export function containedFile(root, relative) {
  check(
    typeof relative === "string" &&
      !path.isAbsolute(relative) &&
      !relative
        .replace(/\\/g, "/")
        .split("/")
        .some(
          (p) =>
            !p ||
            p === ".." ||
            p === "." ||
            p.startsWith(".env") ||
            /^(?:auth(?:\.json)?|credentials|\.app-secret|id_rsa|id_ed25519)$/i.test(
              p,
            ) ||
            /\.(?:key|pem|p12|pfx)$/i.test(p) ||
            /^\.(git|codex|ssh)$/.test(p),
        ),
    "资料路径无效，不能导入系统或密钥目录",
  );
  const base = realpathSync(root),
    file = realpathSync(path.resolve(base, relative)),
    diff = path.relative(base, file);
  check(
    diff &&
      !diff.startsWith("..") &&
      !path.isAbsolute(diff) &&
      statSync(file).isFile(),
    "资料必须位于选定客户目录内，禁止越界或链接到外部文件",
  );
  return file;
}
export function inspectBundle(db, bundle, sourceRoot, userId) {
  check(bundle?.format === "crm-codex-migration-v1", "不是支持的迁移数据包");
  check(
    /^[A-Za-z0-9-]{20,80}$/.test(bundle.source?.threadId || ""),
    "对话标识无效",
  );
  text(bundle.source.title, 200);
  check(
    bundle.source.coverage?.hasMore === false,
    "聊天分页尚未读取完成，禁止当作完整记录导入",
  );
  const customer = bundle.customer;
  check(
    customer && /^\S+@\S+\.\S+$/.test(customer.email || ""),
    "客户邮箱无效",
  );
  for (const k of ["name", "company", "country", "phone"])
    text(customer[k] || "", 200);
  text(bundle.project?.title, 200);
  check(
    ["需求确认", "方案准备", "商务沟通", "暂停"].includes(
      bundle.project?.stage || "方案准备",
    ),
    "试迁不能自动标记已报价或成交",
  );
  check(
    Array.isArray(bundle.items) &&
      bundle.items.length > 0 &&
      bundle.items.length <= 10000,
    "聊天条目数量无效",
  );
  const ids = new Set();
  for (const item of bundle.items) {
    check(
      !ids.has(item.id) && typeof item.id === "string",
      "重复或无效的聊天条目标识",
    );
    ids.add(item.id);
    check(
      ["user", "assistant"].includes(item.role),
      "只迁移人机可见对话，不迁移工具执行及内部推理",
    );
    text(item.body);
    text(item.turnId, 200);
    text(item.recordedAt, 100);
    check(Number.isFinite(Date.parse(item.recordedAt)), "对话记录时间无效");
    check(
      ["", "commentary", "final_answer"].includes(item.phase || ""),
      "禁止迁入内部推理",
    );
  }
  check(
    bundle.source.coverage.visibleMessages === bundle.items.length &&
      bundle.source.coverage.turns ===
        new Set(bundle.items.map((i) => i.turnId)).size,
    "对话覆盖统计不一致，先核对完整性",
  );
  check(
    Array.isArray(bundle.messages) &&
      bundle.messages.length <= 1000 &&
      Array.isArray(bundle.memories) &&
      bundle.memories.length <= 100,
    "沟通或记忆数据无效",
  );
  for (const m of bundle.messages) {
    check(["inbound", "outbound"].includes(m.direction), "沟通方向无效");
    check(
      ["received", "superseded", "historical_draft", "presumed_sent"].includes(
        m.status,
      ),
      "迁移不能伪造确认发送或成交",
    );
    text(m.body);
    text(m.id, 200);
    text(m.sourceRef, 200);
  }
  for (const m of bundle.memories) {
    text(m.content, 10000);
    text(m.sourceRef, 300);
  }
  check(
    Array.isArray(bundle.files) && bundle.files.length <= 1200,
    "附件数量无效",
  );
  const files = bundle.files.map((f) => {
    const absolute = containedFile(sourceRoot, f.path),
      size = statSync(absolute).size;
    check(size <= 25 * 1024 * 1024, "单文件超过25MB");
    check(
      ["customer", "internal"].includes(f.scope),
      "历史资料不得自动作为公司共享文件",
    );
    check(
      ["reference", "incoming", "draft", "internal", "approved"].includes(
        f.role,
      ),
      "附件角色无效",
    );
    check(
      f.role !== "internal" || f.scope === "internal",
      "内部文件必须保持内部权限",
    );
    check(
      !f.path.replace(/\\/g, "/").startsWith("working-files/") ||
        f.scope === "internal",
      "内部工作文件不能进入客户附件",
    );
    check(
      !f.canSend ||
        (f.role === "approved" &&
          f.path.replace(/\\/g, "/").startsWith("customer-ready-attachments/")),
      "只有明确批准的客户附件可用于发送",
    );
    check(
      !f.indexText || /\.(md|txt|csv)$/i.test(f.path),
      "原始PDF或图片不自动提取，避免读取遮盖文本或伪造OCR",
    );
    const sha = hash(readFileSync(absolute));
    check(sha === f.sha256, `资料与预览快照不一致：${f.path}`);
    return { ...f, absolute, size, sha256: sha };
  });
  check(
    files.reduce((n, f) => n + f.size, 0) <= 60 * 1024 * 1024,
    "迁移资料超过60MB，请拆分",
  );
  const user = db
    .prepare("SELECT id,role,status FROM users WHERE id=?")
    .get(userId);
  check(
    user?.role === "admin" && user.status === "active",
    "迁移仅允许有效管理员",
  );
  const normalizedEmail = customer.email.toLowerCase().trim(),
    normalizedPhone = phone(customer.phone);
  const matches = db
    .prepare("SELECT id,email,phone FROM customers")
    .all()
    .filter(
      (c) =>
        String(c.email).toLowerCase() === normalizedEmail ||
        (normalizedPhone && phone(c.phone) === normalizedPhone),
    );
  check(
    new Set(matches.map((c) => c.id)).size <= 1,
    "邮箱与电话对应不同客户，需人工核对，未合并",
  );
  const match = matches[0];
  if (
    match &&
    String(match.email).toLowerCase() !== normalizedEmail &&
    !String(match.email).endsWith("@identity.invalid")
  )
    throw new Error("电话对应另一邮箱，请先核实客户身份");
  const contentHash = hash(
    JSON.stringify({ ...bundle, exportedAt: undefined }),
  );
  const hasTable = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_imports'",
    )
    .get();
  const previous = hasTable
    ? db
        .prepare(
          "SELECT * FROM conversation_imports WHERE source_system='codex' AND thread_id=?",
        )
        .get(bundle.source.threadId)
    : undefined;
  if (previous)
    check(
      previous.source_hash === contentHash,
      "该对话已有不同快照。请先预览增量，禁止自动覆盖原迁移",
    );
  return {
    bundle,
    files,
    contentHash,
    customerId: match?.id,
    previous,
    summary: {
      customer: customer.name,
      company: customer.company,
      existingCustomer: Boolean(match),
      turns: bundle.source.coverage.turns,
      messages: bundle.items.length,
      emailRecords: bundle.messages.length,
      files: files.length,
      approvedFiles: files.filter((f) => f.canSend).length,
      internalFiles: files.filter((f) => f.scope === "internal").length,
      sourceHash: contentHash,
      alreadyImported: Boolean(previous),
    },
  };
}
function folder(db, name, parent, scope, customerId, userId) {
  name =
    String(name)
      .replace(/[\\/\u0000-\u001f]/g, "-")
      .slice(0, 100) || "历史资料";
  db.prepare(
    "INSERT OR IGNORE INTO knowledge_folders(name,parent_id,scope,customer_id,created_by) VALUES(?,?,?,?,?)",
  ).run(name, parent, scope, customerId, userId);
  return db
    .prepare(
      "SELECT id FROM knowledge_folders WHERE name=? AND COALESCE(parent_id,0)=? AND scope=? AND COALESCE(customer_id,0)=?",
    )
    .get(name, parent || 0, scope, customerId || 0).id;
}
export function applyBundle(db, plan, dataDir, userId) {
  if (plan.previous)
    return {
      ...plan.summary,
      importId: plan.previous.id,
      customerId: plan.previous.customer_id,
      projectId: plan.previous.project_id,
      reused: true,
    };
  const { bundle, files } = plan,
    createdFiles = [],
    uploads = path.resolve(dataDir, "uploads");
  mkdirSync(uploads, { recursive: true });
  check(path.dirname(uploads) === path.resolve(dataDir), "原件目录无效");
  db.exec("BEGIN IMMEDIATE");
  try {
    // Recheck under the writer lock; a second import must not create another customer/project.
    const again = inspectBundle(db, bundle, plan.sourceRoot, userId);
    if (again.previous) {
      db.exec("COMMIT");
      return {
        ...again.summary,
        importId: again.previous.id,
        customerId: again.previous.customer_id,
        projectId: again.previous.project_id,
        reused: true,
      };
    }
    let customerId = again.customerId;
    if (!customerId)
      customerId = Number(
        db
          .prepare(
            "INSERT INTO customers(name,email,company,country,phone,owner_id,first_source) VALUES(?,?,?,?,?,?,'email')",
          )
          .run(
            bundle.customer.name,
            bundle.customer.email.toLowerCase().trim(),
            bundle.customer.company,
            bundle.customer.country,
            phone(bundle.customer.phone)
              ? `+${phone(bundle.customer.phone)}`
              : "",
            userId,
          ).lastInsertRowid,
      );
    const p = bundle.project;
    const projectId = Number(
      db
        .prepare(
          "INSERT INTO projects(customer_id,title,stage,product,quantity,destination,waiting_on,next_action) VALUES(?,?,?,?,?,?,?,?)",
        )
        .run(
          customerId,
          p.title,
          p.stage || "方案准备",
          p.product || "",
          p.quantity || "",
          p.destination || "",
          p.waitingOn || "我方",
          p.nextAction || "核对迁入资料后继续跟进",
        ).lastInsertRowid,
    );
    const importId = randomUUID();
    db.prepare(
      "INSERT INTO conversation_imports(id,source_system,thread_id,source_title,source_hash,customer_id,project_id,coverage,imported_by) VALUES(?,'codex',?,?,?,?,?,?,?)",
    ).run(
      importId,
      bundle.source.threadId,
      bundle.source.title,
      plan.contentHash,
      customerId,
      projectId,
      JSON.stringify(bundle.source.coverage),
      userId,
    );
    const itemInsert = db.prepare(
      "INSERT INTO imported_chat_items(import_id,source_item_id,source_turn_id,ordinal,role,phase,body,recorded_at) VALUES(?,?,?,?,?,?,?,?)",
    );
    bundle.items.forEach((item, i) =>
      itemInsert.run(
        importId,
        item.id,
        item.turnId,
        i,
        item.role,
        item.phase || "",
        item.body,
        item.recordedAt,
      ),
    );
    const commIds = new Map();
    for (const m of bundle.messages) {
      const id = Number(
        db
          .prepare(
            "INSERT INTO communications(customer_id,project_id,channel,direction,subject,body,translation,send_status,external_id,created_by,occurred_at,occurred_label,source_ref) VALUES(?,?,'email',?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            customerId,
            projectId,
            m.direction,
            m.subject || "",
            m.body,
            m.translation || "",
            m.status,
            `codex:${bundle.source.threadId}:${m.id}`,
            userId,
            m.recordedAt || bundle.items[0].recordedAt,
            m.occurredLabel || "来源：历史归档，实际邮件时间未核实",
            m.sourceRef,
          ).lastInsertRowid,
      );
      commIds.set(m.id, id);
    }
    for (const m of bundle.memories)
      db.prepare(
        "INSERT INTO customer_memories(customer_id,project_id,content,kind,evidence_id,created_by) VALUES(?,?,?,'codex_import',?,?)",
      ).run(
        customerId,
        projectId,
        `${m.content}\n依据：${m.sourceRef}`,
        commIds.get(m.evidenceMessageId) || null,
        userId,
      );
    for (const file of files) {
      const ext = path.extname(file.path).toLowerCase(),
        stored = `${randomUUID()}${ext}`,
        destination = path.join(uploads, stored);
      check(!existsSync(destination), "原件存储标识冲突");
      copyFileSync(file.absolute, destination, constants.COPYFILE_EXCL);
      createdFiles.push(destination);
      check(
        hash(readFileSync(destination)) === file.sha256,
        "附件副本校验失败",
      );
      const cid = file.scope === "customer" ? customerId : null;
      let parent = folder(
        db,
        bundle.customer.company || bundle.customer.name,
        null,
        file.scope,
        cid,
        userId,
      );
      parent = folder(
        db,
        p.folderName || p.title,
        parent,
        file.scope,
        cid,
        userId,
      );
      parent = folder(
        db,
        {
          incoming: "原始询盘与附件",
          draft: "历史邮件草稿",
          internal: "内部工作资料",
          approved: "已批准可发附件",
          reference: "客户档案与记录",
        }[file.role],
        parent,
        file.scope,
        cid,
        userId,
      );
      const content = file.indexText ? readFileSync(file.absolute, "utf8") : "";
      const id = Number(
        db
          .prepare(
            "INSERT INTO knowledge_files(original_name,source_path,stored_name,mime_type,size_bytes,category,summary,status,uploaded_by,scope,customer_id,content_hash,version,is_current,folder_id,auto_organize,organize_status,manual_folder,can_send) VALUES(?,?,?,?,?,?,?,'ready',?,?,?,?,1,?,?,0,'历史归档（未调用AI）',1,?)",
          )
          .run(
            path.basename(file.path),
            `Codex/${bundle.source.threadId}/${file.path}`,
            stored,
            file.mime || "application/octet-stream",
            file.size,
            {
              incoming: "客户原始资料",
              draft: "历史草稿",
              internal: "内部参考",
              approved: "客户可发附件",
              reference: "客户记录",
            }[file.role],
            file.summary || "Codex客户历史迁入；保留原件与来源，不代表已发送。",
            userId,
            file.scope,
            cid,
            file.sha256,
            file.role === "draft" && file.path.startsWith("email-drafts/")
              ? 0
              : 1,
            parent,
            file.canSend ? 1 : 0,
          ).lastInsertRowid,
      );
      let chunks = 0;
      for (let offset = 0; offset < content.length; offset += 2800) {
        db.prepare(
          "INSERT INTO knowledge_chunks(file_id,chunk_index,content,keywords) VALUES(?,?,?,?)",
        ).run(
          id,
          chunks++,
          content.slice(offset, offset + 3200),
          `${bundle.customer.company} ${p.folderName || p.title} ${file.path}`,
        );
      }
      if (file.originalOnly)
        db.prepare(
          "UPDATE knowledge_files SET index_policy='original_only' WHERE id=?",
        ).run(id);
      db.prepare("UPDATE knowledge_files SET chunk_count=? WHERE id=?").run(
        chunks,
        id,
      );
      db.prepare(
        "INSERT INTO imported_files(import_id,file_id,original_path,sha256,role) VALUES(?,?,?,?,?)",
      ).run(importId, id, file.path, file.sha256, file.role);
    }
    db.prepare(
      "INSERT INTO audit_logs(user_id,action,entity_type,entity_id,detail) VALUES(?,'Codex本地试迁','conversation_import',?,?)",
    ).run(
      userId,
      importId,
      JSON.stringify({
        threadId: bundle.source.threadId,
        items: bundle.items.length,
        files: files.length,
        externalCalls: 0,
      }),
    );
    db.prepare(
      "UPDATE customers SET updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).run(customerId);
    db.exec("COMMIT");
    return { ...plan.summary, importId, customerId, projectId, reused: false };
  } catch (e) {
    db.exec("ROLLBACK");
    for (const file of createdFiles)
      try {
        if (path.dirname(file) === uploads) unlinkSync(file);
      } catch {}
    throw e;
  }
}
