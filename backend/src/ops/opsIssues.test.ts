import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { writeTable } from "../projectStorage.js";
import { collectOpsIssues } from "./opsIssues.js";
import { collectExtraIssues } from "../schemaIssues.js";
import { transitionApproval } from "./service.js";
import { accessStore } from "./stores.js";

let ROOT = "";
const ts = "2026-01-01T00:00:00.000Z";
const table = (extra: Record<string, unknown> = {}) => ({ id: "orders", uuid: "44444444-4444-4444-8444-444444444441", physicalName: "orders", name: "注文", createdAt: ts, updatedAt: ts, columns: [], ...extra });
beforeEach(async () => {
  ROOT = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ops-issues-")));
  await fs.mkdir(path.join(ROOT, "harmony", "tables"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "00000000-0000-4000-8000-00000000000c", name: "t", createdAt: ts, updatedAt: ts }, entities: { tables: [{ id: "orders", no: 1, name: "注文", physicalName: "orders", maturity: "draft", updatedAt: ts }] } }));
  await writeTable("orders", table({ maturity: "committed" }), ROOT);
});
afterEach(async () => { await fs.rm(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

describe("運用の記録の「要確認」", () => {
  it("方針が無効なら、確定の設計に承認が無くても、何も出さない", async () => {
    expect(await collectOpsIssues(ROOT)).toEqual([]);
  });

  it("方針が有効なとき、承認のない確定の設計を警告にする。承認すると消え、内容が変わると「承認後に変更」で出る", async () => {
    await accessStore.update(ROOT, () => ({ version: 1, users: [], policy: { requireApprovalForCommitted: true } }));
    const unapproved = await collectOpsIssues(ROOT);
    expect(unapproved).toHaveLength(1);
    expect(unapproved[0]).toMatchObject({ severity: "warning", section: "テーブル 注文", ref: { kind: "table", id: "orders" } });
    expect(unapproved[0].message).toContain("承認されていません");
    await transitionApproval(ROOT, "", { kind: "table", id: "orders", to: "review" });
    await transitionApproval(ROOT, "", { kind: "table", id: "orders", to: "approved" });
    expect(await collectOpsIssues(ROOT)).toEqual([]);
    // 承認後に、内容を変える (方針を一時的に切って保存する)
    await accessStore.update(ROOT, () => ({ version: 1, users: [], policy: { requireApprovalForCommitted: false } }));
    await writeTable("orders", table({ maturity: "committed", comment: "変更" }), ROOT);
    await accessStore.update(ROOT, () => ({ version: 1, users: [], policy: { requireApprovalForCommitted: true } }));
    const stale = await collectOpsIssues(ROOT);
    expect(stale).toHaveLength(1);
    expect(stale[0].message).toContain("承認のあとに内容が変わっています");
  });

  it("下書き・暫定の設計は、方針が有効でも問題にしない。設計書・点検に出る要確認 (collectExtraIssues) にも含まれる", async () => {
    await writeTable("orders", table({ maturity: "provisional" }), ROOT);
    await accessStore.update(ROOT, () => ({ version: 1, users: [], policy: { requireApprovalForCommitted: true } }));
    expect(await collectOpsIssues(ROOT)).toEqual([]);
    await writeTable("orders", table({ maturity: "committed" }), ROOT).catch(() => undefined); // 方針で止まるので、直接書く
    await fs.writeFile(path.join(ROOT, "harmony", "tables", "orders.json"), JSON.stringify(table({ maturity: "committed" })));
    expect((await collectExtraIssues(ROOT)).some((i) => i.message.includes("承認されていません"))).toBe(true);
  });

  it("運用の記録の読めない項目・壊れた JSON を、警告として知らせる", async () => {
    await fs.writeFile(path.join(ROOT, "harmony", "approvals.json"), JSON.stringify({ version: 1, items: [{ kind: "nothing", id: "x", state: "review" }] }));
    await fs.writeFile(path.join(ROOT, "harmony", "access.json"), "{壊れた");
    const issues = await collectOpsIssues(ROOT);
    expect(issues.some((i) => i.section === "読み込み" && i.message.includes("承認の 1 件目が読めません"))).toBe(true);
    expect(issues.some((i) => i.section === "読み込み" && i.message.includes("access.json が JSON として読めません"))).toBe(true);
  });
});
