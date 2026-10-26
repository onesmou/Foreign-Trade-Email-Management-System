import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only")
      return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (
      specifier.startsWith(".") &&
      context.parentURL?.includes("/lib/") &&
      !path.extname(specifier)
    )
      return next(new URL(`${specifier}.ts`, context.parentURL).href, context);
    return next(specifier, context);
  },
});

test("completion regressions: access revocation, safe progress, WhatsApp project routing, durable daily backups and synthetic vision", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "crm-completion-"));
  process.env.DATA_DIR = dir;
  const { getDb } = await import("../lib/db.ts");
  const db = getDb();
  const { changeCustomerAccess } =
    await import("../lib/customer-permissions.ts");
  const { customerFor, addProject, addCommunication } =
    await import("../lib/crm.ts");
  const { applyProgressSuggestion, latestProgressMessage } =
    await import("../lib/progress-review.ts");
  const { archiveInbox, saveInboxMessage } =
    await import("../lib/whatsapp-store.ts");
  const { runScheduledBackup, saveBackupSchedule, backupScheduleStatus } =
    await import("../lib/backup-schedule.ts");
  try {
    for (const [id, role] of [
      [1, "admin"],
      [2, "sales"],
      [3, "sales"],
      [4, "viewer"],
    ])
      db.prepare(
        "INSERT INTO users(id,name,email,password_hash,role) VALUES(?,?,?,?,?)",
      ).run(
        id,
        `Synthetic ${id}`,
        `user${id}@example.test`,
        "not-a-real-password",
        role,
      );
    db.prepare(
      "INSERT INTO customers(id,name,email,owner_id) VALUES(1,'Synthetic client','client@example.test',2)",
    ).run();
    const sales = (id) => ({
      id,
      role: "sales",
      name: "Synthetic",
      email: `user${id}@example.test`,
    });
    await t.test(
      "revoke and transfer remove old customer access without deleting business records",
      () => {
        assert.throws(() => customerFor(sales(3), 1), /未获授权/);
        changeCustomerAccess(1, 3, "grant");
        assert.equal(customerFor(sales(3), 1).id, 1);
        changeCustomerAccess(1, 3, "revoke");
        assert.throws(() => customerFor(sales(3), 1), /未获授权/);
        assert.throws(() => changeCustomerAccess(1, 2, "revoke"), /先转交/);
        assert.throws(() => changeCustomerAccess(1, 1, "revoke"), /全局/);
        assert.throws(() => changeCustomerAccess(1, 4, "transfer"), /只读/);
        changeCustomerAccess(1, 3, "grant");
        changeCustomerAccess(1, 3, "transfer");
        assert.throws(() => customerFor(sales(2), 1), /未获授权/);
        assert.equal(customerFor(sales(3), 1).owner_id, 3);
        assert.equal(db.prepare("SELECT COUNT(*) n FROM customers").get().n, 1);
      },
    );
    const project = addProject(1, "Synthetic procurement");
    const add = (body, opts = {}) =>
      addCommunication({
        customerId: 1,
        projectId: project,
        channel: "email",
        body,
        analyze: false,
        ...opts,
      });
    const proposal = (message, payload = {}) => {
      const revision = db
        .prepare("SELECT progress_revision FROM projects WHERE id=?")
        .get(project).progress_revision;
      return Number(
        db
          .prepare(
            "INSERT INTO progress_suggestions(customer_id,project_id,evidence_id,payload,project_revision,basis_message_id) VALUES(1,?,?,?,?,?)",
          )
          .run(
            project,
            message,
            JSON.stringify({
              summary: "Synthetic workflow only",
              product: "",
              quantity: "",
              destination: "",
              waiting_on: "客户",
              next_action: "等客户核对",
              conflicts: [],
              ...payload,
            }),
            revision,
            message,
          ).lastInsertRowid,
      );
    };
    await t.test(
      "drafts, unknown deliveries and older imported history cannot become the latest business evidence",
      () => {
        const id = add("Real inbound", {
          occurredAt: "2026-10-25T09:00:00Z",
          externalId: "dedup-1",
        });
        add("Draft", {
          direction: "outbound",
          status: "draft",
          occurredAt: "2026-10-26T09:00:00Z",
        });
        add("Unknown", {
          direction: "outbound",
          status: "unknown",
          occurredAt: "2026-10-26T10:00:00Z",
        });
        add("Old history", { occurredAt: "2025-01-01T00:00:00Z" });
        assert.equal(latestProgressMessage(project).id, id);
        assert.equal(
          add("Duplicate must not return the unrelated last insert", {
            externalId: "dedup-1",
          }),
          id,
        );
        const sent = add("Phone reply", {
          direction: "outbound",
          status: "synced",
          occurredAt: "2026-10-26T11:00:00Z",
        });
        assert.equal(latestProgressMessage(project).id, sent);
      },
    );
    await t.test(
      "safe auto is opt-in, keeps follow-up dates and never silently confirms new product facts",
      () => {
        const a = add("Workflow", { occurredAt: "2026-10-27T00:00:00Z" });
        const suggestion = proposal(a);
        assert.equal(
          applyProgressSuggestion(suggestion, null, true).applied,
          false,
        );
        db.prepare(
          "UPDATE projects SET auto_progress=1,waiting_on='客户',follow_up='2026-11-05' WHERE id=?",
        ).run(project);
        assert.equal(
          applyProgressSuggestion(suggestion, null, true).applied,
          true,
        );
        assert.equal(
          db.prepare("SELECT follow_up FROM projects WHERE id=?").get(project)
            .follow_up,
          "2026-11-05",
        );
        const b = add("New product", { occurredAt: "2026-10-28T00:00:00Z" });
        const next = proposal(b, { product: "NEW-PRODUCT" });
        assert.equal(applyProgressSuggestion(next, null, true).applied, false);
        assert.equal(
          db.prepare("SELECT product FROM projects WHERE id=?").get(project)
            .product,
          "",
        );
        assert.equal(applyProgressSuggestion(next, 1).applied, true);
        assert.equal(
          db.prepare("SELECT product FROM projects WHERE id=?").get(project)
            .product,
          "NEW-PRODUCT",
        );
        const c = add("Wait on us", { occurredAt: "2026-10-29T00:00:00Z" });
        assert.equal(
          applyProgressSuggestion(
            proposal(c, { waiting_on: "我方" }),
            null,
            true,
          ).applied,
          true,
        );
        assert.equal(
          db.prepare("SELECT follow_up FROM projects WHERE id=?").get(project)
            .follow_up,
          "",
        );
        const d = add("Wait on customer", {
          occurredAt: "2026-10-30T00:00:00Z",
        });
        applyProgressSuggestion(proposal(d), null, true);
        assert.match(
          db.prepare("SELECT follow_up FROM projects WHERE id=?").get(project)
            .follow_up,
          /^\d{4}-\d{2}-\d{2}$/,
        );
      },
    );
    await t.test(
      "a manual edit, newer message or conflict invalidates unattended progress application",
      () => {
        const a = add("Older", { occurredAt: "2026-11-01T00:00:00Z" });
        const stale = proposal(a);
        add("Newer", { occurredAt: "2026-11-02T00:00:00Z" });
        assert.equal(applyProgressSuggestion(stale, 1).applied, false);
        const latest = latestProgressMessage(project).id;
        const changed = proposal(latest);
        db.prepare(
          "UPDATE projects SET progress_revision=progress_revision+1 WHERE id=?",
        ).run(project);
        assert.equal(applyProgressSuggestion(changed, 1).applied, false);
        db.prepare("DELETE FROM progress_suggestions WHERE evidence_id=?").run(
          latest,
        );
        assert.throws(
          () =>
            applyProgressSuggestion(
              proposal(latest, { conflicts: ["quantity conflict"] }),
              null,
              true,
            ),
          /冲突/,
        );
      },
    );
    await t.test(
      "multi-project WhatsApp uses a validated default only for new messages",
      () => {
        const second = addProject(1, "Second procurement");
        const jid = "15555550199@s.whatsapp.net";
        db.prepare(
          "INSERT INTO wa_contacts(jid,name,customer_id,selected) VALUES(?,'Synthetic WhatsApp',1,1)",
        ).run(jid);
        saveInboxMessage({
          jid,
          key: "unassigned",
          fromMe: false,
          body: "Unassigned",
          timestamp: 1700000000,
          rawKey: { id: "unassigned", remoteJid: jid },
        });
        archiveInbox(jid);
        assert.equal(
          db
            .prepare(
              "SELECT project_id FROM communications WHERE external_id=?",
            )
            .get("wa:1:unassigned").project_id,
          null,
        );
        db.prepare(
          "UPDATE wa_contacts SET default_project_id=? WHERE jid=?",
        ).run(second, jid);
        saveInboxMessage({
          jid,
          key: "assigned",
          fromMe: true,
          body: "Phone reply",
          status: "synced",
          timestamp: 1700000010,
          rawKey: { id: "assigned", remoteJid: jid, fromMe: true },
        });
        archiveInbox(jid);
        assert.equal(
          db
            .prepare(
              "SELECT project_id FROM communications WHERE external_id=?",
            )
            .get("wa:1:assigned").project_id,
          second,
        );
        assert.equal(
          db
            .prepare(
              "SELECT project_id FROM communications WHERE external_id=?",
            )
            .get("wa:1:unassigned").project_id,
          null,
        );
        assert.ok(project !== second);
      },
    );
    await t.test(
      "daily scheduler is disabled by default, uses Beijing dates, deduplicates concurrent work and records bounded retries",
      async () => {
        process.env.BACKUP_PASSPHRASE = "SyntheticBackup2026!";
        let calls = 0;
        const create = async () => {
          calls++;
          await new Promise((r) => setTimeout(r, 5));
          return { id: `synthetic-${calls}.crmbackup` };
        };
        assert.equal(
          (
            await runScheduledBackup(
              new Date("2026-11-01T00:00:00Z"),
              false,
              create,
            )
          ).skipped,
          true,
        );
        assert.equal(calls, 0);
        saveBackupSchedule(true, 3);
        assert.equal(
          (
            await runScheduledBackup(
              new Date("2026-11-01T18:00:00Z"),
              false,
              create,
            )
          ).skipped,
          true,
          "02:00 Beijing is before the schedule",
        );
        const results = await Promise.all([
          runScheduledBackup(new Date("2026-11-01T19:00:00Z"), false, create),
          runScheduledBackup(new Date("2026-11-01T19:00:01Z"), false, create),
        ]);
        assert.equal(calls, 1);
        assert.equal(results.filter((r) => !r.skipped).length, 1);
        assert.equal(backupScheduleStatus().lastRun.day, "2026-11-02");
        assert.equal(backupScheduleStatus().lastRun.status, "success");
        const fail = async () => {
          throw Error("Do not leak SyntheticBackup2026!");
        };
        for (let i = 0; i < 3; i++)
          await assert.rejects(
            runScheduledBackup(
              new Date(Date.parse("2026-11-03T00:00:00Z") + i * 16 * 60000),
              false,
              fail,
            ),
            /备份失败/,
          );
        assert.equal(
          (
            await runScheduledBackup(
              new Date("2026-11-03T01:00:00Z"),
              false,
              create,
            )
          ).skipped,
          true,
        );
        assert.equal(backupScheduleStatus().lastRun.attempts, 3);
        assert.ok(
          !backupScheduleStatus().lastRun.error.includes("SyntheticBackup"),
        );
        assert.equal(backupScheduleStatus().offsite, "not_configured");
        delete process.env.BACKUP_PASSPHRASE;
        assert.throws(() => saveBackupSchedule(true, 3), /BACKUP_PASSPHRASE/);
      },
    );
    await t.test(
      "vision probes are real random-content PNG images, not a prompt that reveals the expected answer",
      async () => {
        const { createVisionProbe } = await import("../lib/vision-probe.ts");
        const a = await createVisionProbe("1234"),
          b = await createVisionProbe("5678");
        assert.equal(a.expected, "1234");
        assert.equal((await sharp(a.image).metadata()).format, "png");
        assert.ok(!a.image.equals(b.image));
        await assert.rejects(() => createVisionProbe("invalid"));
      },
    );
  } finally {
    delete process.env.BACKUP_PASSPHRASE;
    db.close();
    global.__rehabCrmDb = undefined;
    rmSync(dir, { recursive: true, force: true });
  }
});
