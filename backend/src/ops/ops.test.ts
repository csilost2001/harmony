import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { parseAccess, can, hasAdmin, canonicalForHash, effectiveStatus, type Webhook } from "@harmony/shared";
import { writeTable } from "../projectStorage.js";
import { installApprovalGuard, PermissionError, requireRole } from "./policy.js";
import { accessStore, approvalsStore, commentsStore, generationStore, templateStore } from "./stores.js";
import { addComment, generationStatus, listApprovals, recordGeneration, regenerationDiff, resolveThread, transitionApproval } from "./service.js";
import { AUDIT_MAX_BYTES, parseAuditLines, readAudit, recordAudit } from "./audit.js";
import { isPrivateAddress, sendWebhook, dispatchNotify, type SendDeps } from "./notifySend.js";
import { assertBranchName, assertGitPath, execOverrides, gitBranches, gitCheckout, gitCommit, gitDiff, gitInit, gitLog, gitStatus } from "./gitOps.js";
import { branchName, checkForUpdate, describeFetchError, createUpdateCheckMemo, harmonySummary, parseReleaseNotes, readBuildInfo, readVersionInfo, resetHarmonySummaryCache, type UpdateCheck } from "./versionInfo.js";
import { suggestRevision } from "./revisionSuggest.js";
import { createdIdFromResultText, describeAiTool, describeRpc, isAiDryRun, isAiNoWrite } from "./auditMap.js";

let ROOT = "";
const ts = "2026-01-01T00:00:00.000Z";
const table = (extra: Record<string, unknown> = {}) => ({
  id: "orders", uuid: "44444444-4444-4444-8444-444444444441", physicalName: "orders", name: "注文", createdAt: ts, updatedAt: ts,
  columns: [{ id: "id", no: 1, physicalName: "id", name: "ID", dataType: "BIGINT", primaryKey: true, notNull: true }], ...extra,
});
async function seed() {
  await fs.mkdir(path.join(ROOT, "harmony", "tables"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "00000000-0000-4000-8000-00000000000c", name: "試験", createdAt: ts, updatedAt: ts }, entities: { tables: [{ id: "orders", no: 1, name: "注文", physicalName: "orders", maturity: "draft", updatedAt: ts }] } }));
  await writeTable("orders", table(), ROOT);
}
beforeEach(async () => { ROOT = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ops-"))); await seed(); installApprovalGuard(); });
afterEach(async () => { await fs.rm(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

const setAccess = (users: Array<{ name: string; role: string }>, requireApproval = false) =>
  accessStore.update(ROOT, () => ({ version: 1, users, policy: { requireApprovalForCommitted: requireApproval } }) as never);

describe("利用者と役割", () => {
  it("設定が無ければ制限しない。あれば、役割の強さで判定し、未登録の名前は「閲覧」", () => {
    const none = parseAccess(undefined).value;
    expect(can(none, "", "admin")).toBe(true);
    const a = parseAccess({ users: [{ name: "花子", role: "editor" }, { name: "太郎", role: "admin" }, { name: "次郎", role: "approver" }] }).value;
    expect(can(a, "花子", "editor")).toBe(true);
    expect(can(a, "花子", "approver")).toBe(false);
    expect(can(a, "次郎", "editor")).toBe(true);
    expect(can(a, "太郎", "admin")).toBe(true);
    expect(can(a, "知らない人", "viewer")).toBe(true);
    expect(can(a, "知らない人", "editor")).toBe(false);
    expect(can(a, "", "editor")).toBe(false);
    expect(can(a, "花子 ", "editor")).toBe(true); // 前後の空白は無視
    expect(hasAdmin(a)).toBe(true);
    expect(hasAdmin(parseAccess({ users: [{ name: "a", role: "editor" }] }).value)).toBe(false);
  });
  it("読めない役割・重複する名前は、捨てて理由を返す", () => {
    const r = parseAccess({ users: [{ name: "a", role: "boss" }, { name: "b", role: "admin" }, { name: "B", role: "editor" }, { role: "admin" }] });
    expect(r.value.users).toEqual([{ name: "b", role: "admin" }]);
    expect(r.problems).toHaveLength(3);
  });
  it("requireRole は、設定があるときだけ、足りない役割を日本語で拒否する", async () => {
    await requireRole(ROOT, "", "admin", "設定を変えること"); // 設定なし = 制限しない
    await setAccess([{ name: "花子", role: "viewer" }, { name: "太郎", role: "admin" }]);
    await expect(requireRole(ROOT, "花子", "editor", "設計を変えること")).rejects.toThrow(/「編集」以上.*「閲覧」/);
    await expect(requireRole(ROOT, "", "editor", "設計を変えること")).rejects.toThrow(/利用者名が未設定/);
    await requireRole(ROOT, "太郎", "editor", "設計を変えること");
    await expect(requireRole(ROOT, "花子", "editor", "x")).rejects.toBeInstanceOf(PermissionError);
  });
});

describe("承認", () => {
  it("下書き → 承認待ち → 承認済み。承認したときの内容の印を残し、内容が変わると「承認後に変更」になる", async () => {
    const r1 = await transitionApproval(ROOT, "花子", { kind: "table", id: "orders", to: "review" });
    expect(r1.state).toBe("review");
    const r2 = await transitionApproval(ROOT, "太郎", { kind: "table", id: "orders", to: "approved", note: "確認済み" });
    expect(r2.state).toBe("approved");
    expect(r2.hash).toMatch(/^[0-9a-f]{64}$/);
    let rows = (await listApprovals(ROOT)).rows;
    expect(rows[0]).toMatchObject({ status: "approved", name: "注文" });
    expect(rows[0].history.map((h) => [h.state, h.by])).toEqual([["review", "花子"], ["approved", "太郎"]]);
    // 内容を変えて保存すると、承認後に変更された扱い
    await writeTable("orders", table({ comment: "変更" }), ROOT);
    rows = (await listApprovals(ROOT)).rows;
    expect(rows[0].status).toBe("stale");
    // 成熟度・更新日時の変更だけでは、変わったことにならない
    await transitionApproval(ROOT, "花子", { kind: "table", id: "orders", to: "draft" });
    await transitionApproval(ROOT, "花子", { kind: "table", id: "orders", to: "review" });
    await transitionApproval(ROOT, "太郎", { kind: "table", id: "orders", to: "approved" });
    await writeTable("orders", table({ comment: "変更", maturity: "committed", updatedAt: "2026-02-02T00:00:00.000Z" }), ROOT);
    expect((await listApprovals(ROOT)).rows[0].status).toBe("approved");
  });
  it("承認・差し戻しは「承認」以上の役割。差し戻しには理由が要る。できない遷移・存在しない設計は拒否する", async () => {
    await setAccess([{ name: "花子", role: "editor" }, { name: "次郎", role: "approver" }, { name: "太郎", role: "admin" }]);
    await transitionApproval(ROOT, "花子", { kind: "table", id: "orders", to: "review" });
    await expect(transitionApproval(ROOT, "花子", { kind: "table", id: "orders", to: "approved" })).rejects.toThrow(/「承認」以上/);
    await expect(transitionApproval(ROOT, "次郎", { kind: "table", id: "orders", to: "rejected" })).rejects.toThrow(/理由/);
    await transitionApproval(ROOT, "次郎", { kind: "table", id: "orders", to: "rejected", note: "桁が足りない" });
    await expect(transitionApproval(ROOT, "次郎", { kind: "table", id: "orders", to: "approved" })).rejects.toThrow(/変えられません/);
    await expect(transitionApproval(ROOT, "花子", { kind: "table", id: "nothing", to: "review" })).rejects.toThrow(/見つかりません/);
    await expect(transitionApproval(ROOT, "花子", { kind: "bogus", id: "x", to: "review" })).rejects.toThrow(/指定/);
    const row = (await listApprovals(ROOT)).rows[0];
    expect(row.history.at(-1)).toMatchObject({ state: "rejected", by: "次郎", note: "桁が足りない" });
  });
  it("方針「確定には承認が必要」が有効なとき、承認のない確定の保存を止める (画面・AI のどちらの書き込みも)。承認があれば通り、内容が変わると止まる", async () => {
    await setAccess([{ name: "太郎", role: "admin" }], true);
    await expect(writeTable("orders", table({ maturity: "committed" }), ROOT)).rejects.toThrow(/承認が必要/);
    // 下書き・暫定のままの保存は、止めない
    await writeTable("orders", table({ maturity: "provisional", comment: "a" }), ROOT);
    await transitionApproval(ROOT, "太郎", { kind: "table", id: "orders", to: "review" });
    await transitionApproval(ROOT, "太郎", { kind: "table", id: "orders", to: "approved" });
    await writeTable("orders", table({ maturity: "committed", comment: "a" }), ROOT); // 承認した内容のまま、成熟度だけ確定
    await expect(writeTable("orders", table({ maturity: "committed", comment: "b" }), ROOT)).rejects.toThrow(/承認のあとに内容が変わっています/);
    // 方針を切ると、止めない
    await setAccess([{ name: "太郎", role: "admin" }], false);
    await writeTable("orders", table({ maturity: "committed", comment: "b" }), ROOT);
  });
  it("hash は、キーの順・成熟度・更新日時に左右されない", () => {
    expect(canonicalForHash({ b: 1, a: { y: 1, x: 2 }, maturity: "draft", updatedAt: "x" })).toBe(canonicalForHash({ updatedAt: "y", a: { x: 2, y: 1 }, b: 1, maturity: "committed" }));
    expect(canonicalForHash({ a: 1 })).not.toBe(canonicalForHash({ a: 2 }));
    // 入れ子の中の maturity は、内容の一部 (処理フローの meta は除く)
    expect(canonicalForHash({ cols: [{ maturity: "draft" }] })).not.toBe(canonicalForHash({ cols: [{ maturity: "committed" }] }));
    expect(canonicalForHash({ meta: { maturity: "draft", name: "a" } })).toBe(canonicalForHash({ meta: { maturity: "committed", name: "a" } }));
    expect(effectiveStatus(undefined, "h")).toBe("none");
    // 自前の `__proto__` キーも、内容として印に入る (原型の指定として、落ちない)
    const withProto = JSON.parse('{"a":1,"__proto__":{"x":1}}');
    expect(canonicalForHash(withProto)).not.toBe(canonicalForHash({ a: 1 }));
    expect(canonicalForHash(withProto)).toContain("__proto__");
  });
});

describe("レビューコメント", () => {
  it("スレッドを作り、返信し、解決し、返信で開き直せる。解決は「編集」以上", async () => {
    await setAccess([{ name: "花子", role: "viewer" }, { name: "太郎", role: "editor" }]);
    const { threadId } = await addComment(ROOT, "花子", { target: { kind: "table", id: "orders", path: "columns[0]" }, text: "桁数は？" });
    await addComment(ROOT, "太郎", { threadId, text: "20 桁にします" });
    await expect(resolveThread(ROOT, "花子", threadId, true)).rejects.toThrow(/「編集」以上/);
    await resolveThread(ROOT, "太郎", threadId, true);
    let th = (await commentsStore.read(ROOT)).value.threads[0];
    expect(th).toMatchObject({ status: "resolved", resolvedBy: "太郎", target: { kind: "table", id: "orders", path: "columns[0]" } });
    expect(th.messages.map((m) => [m.by, m.text])).toEqual([["花子", "桁数は？"], ["太郎", "20 桁にします"]]);
    await addComment(ROOT, "花子", { threadId, text: "やはり 30 桁" });
    th = (await commentsStore.read(ROOT)).value.threads[0];
    expect(th.status).toBe("open");
    expect(th.resolvedBy).toBeUndefined();
  });
  it("空のコメント・長すぎるコメント・存在しない設計・存在しないスレッドは拒否する。AI のコメントは AI レビューとして残る", async () => {
    await expect(addComment(ROOT, "a", { target: { kind: "table", id: "orders" }, text: "  " })).rejects.toThrow(/書いてください/);
    await expect(addComment(ROOT, "a", { target: { kind: "table", id: "orders" }, text: "x".repeat(4001) })).rejects.toThrow(/長すぎ/);
    await expect(addComment(ROOT, "a", { target: { kind: "table", id: "none" }, text: "x" })).rejects.toThrow(/見つかりません/);
    await expect(addComment(ROOT, "a", { threadId: "t-none", text: "x" })).rejects.toThrow(/スレッド/);
    await addComment(ROOT, "AI", { target: { kind: "table", id: "orders" }, text: "主キーが複合では？", ai: true, source: "ai-review", severity: "warning" });
    const th = (await commentsStore.read(ROOT)).value.threads[0];
    expect(th).toMatchObject({ source: "ai-review", severity: "warning" });
    expect(th.messages[0]).toMatchObject({ by: "AI レビュー", ai: true });
  });
});

describe("監査ログ", () => {
  it("書いた順に残り、新しい順に読める。利用者・操作・語で絞れる。壊れた行は飛ばす", async () => {
    await recordAudit(ROOT, { actor: "花子", action: "テーブルを保存した", target: "orders", via: "ui", at: "2026-10-01T00:00:00.000Z" });
    await recordAudit(ROOT, { actor: "太郎", action: "承認の状態を「承認済み」にした", target: "テーブル 注文", at: "2026-10-02T00:00:00.000Z" });
    await recordAudit(ROOT, { actor: "AI", action: "AI が record_generation を実行した", via: "ai", at: "2026-10-03T00:00:00.000Z" });
    await fs.appendFile(path.join(ROOT, ".harmony-ops", "audit.jsonl"), "壊れた行\n{\"x\":1}\n");
    const all = await readAudit(ROOT);
    expect(all.entries.map((e) => e.actor)).toEqual(["AI", "太郎", "花子"]);
    expect(all.actors).toEqual(["AI", "太郎", "花子"].sort());
    expect((await readAudit(ROOT, { actor: "花子" })).entries).toHaveLength(1);
    expect((await readAudit(ROOT, { q: "注文" })).entries.map((e) => e.actor)).toEqual(["太郎"]);
    expect((await readAudit(ROOT, { since: "2026-10-02T00:00:00.000Z", until: "2026-10-02T23:59:59.000Z" })).entries).toHaveLength(1);
    expect((await readAudit(ROOT, { limit: 1 })).entries).toHaveLength(1);
    expect((await readAudit(ROOT, { limit: 1 })).total).toBe(3);
    expect(parseAuditLines("壊れ\n").length).toBe(0);
    // 個人の記録なので、git には載せない
    expect(await fs.readFile(path.join(ROOT, ".harmony-ops", ".gitignore"), "utf-8")).toBe("*\n");
  });
  it("大きくなったら 1 世代だけ退避し、退避分も読める。名前が空・改行は整える", async () => {
    const dir = path.join(ROOT, ".harmony-ops");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "audit.jsonl"), `${JSON.stringify({ at: "2026-01-01T00:00:00.000Z", actor: "古い人", action: "古い操作" })}\n${" ".repeat(AUDIT_MAX_BYTES)}`);
    await recordAudit(ROOT, { actor: "", action: "新しい\n操作" });
    await fs.access(path.join(dir, "audit.1.jsonl"));
    const r = await readAudit(ROOT);
    expect(r.entries.map((e) => e.actor)).toEqual(["(名前なし)", "古い人"]);
    expect(r.entries[0].action).toBe("新しい 操作");
  });
  it("画面の操作の文と、対象を作る (保存した設計・編集セッションの対象)。確認だけ・衝突の保存は残さない", () => {
    expect(describeRpc("saveTable", { tableId: "orders" })).toEqual({ action: "テーブルを保存した", target: "orders" });
    expect(describeRpc("loadTable", { tableId: "orders" })).toBeNull();
    expect(describeRpc("editSession.save", { editSessionId: "e" }, { ok: true }, "table orders")).toEqual({ action: "編集内容を保存した", target: "table orders" });
    expect(describeRpc("editSession.save", { stage: "checkOnly" }, { ok: true }, "table orders")).toBeNull();
    expect(describeRpc("editSession.save", {}, { ok: false, conflict: {} }, "table orders")).toBeNull();
    expect(describeRpc("saveGenericDefinition", { kind: "message", name: "M" })?.target).toBe("message/M");
  });
});

describe("設計書の体裁の保存", () => {
  it("検証に通らない入力は、書かずに理由を返し、読めない項目のあるファイルへは上書きしない", async () => {
    await expect(templateStore.update(ROOT, () => ({ version: 1, accentColor: "red", excludeChapters: [], revisions: [] }) as never)).rejects.toThrow(/#rrggbb/);
    await templateStore.update(ROOT, () => ({ version: 1, documentTitle: "要件定義書", excludeChapters: ["crud"], revisions: [{ version: "1.0", date: "2026-10-01", summary: "初版" }] }));
    expect((await templateStore.read(ROOT)).value.documentTitle).toBe("要件定義書");
    const file = await templateStore.file(ROOT);
    await fs.writeFile(file, JSON.stringify({ version: 1, accentColor: "bad", revisions: [{ version: "1", date: "2026-10-01", summary: "残す" }] }));
    await expect(templateStore.update(ROOT, (t) => t)).rejects.toThrow(/書き換えません/);
    expect(JSON.parse(await fs.readFile(file, "utf-8")).accentColor).toBe("bad");
    // 利用者が捨てることを承知すれば、読める分だけ残して書く
    const r = await templateStore.update(ROOT, (t) => t, { discardUnreadable: true });
    expect(r.value.revisions).toHaveLength(1);
    await fs.writeFile(file, "{壊れた JSON");
    await expect(templateStore.update(ROOT, (t) => t, { discardUnreadable: true })).rejects.toThrow(/書き換えません/); // 構文が壊れたものは、承知しても書かない
  });
  it("改訂履歴の下書き: 前回の改訂のあとに更新された設計を、拾う", async () => {
    await writeTable("orders", table({ comment: "1" }), ROOT);
    await writeTable("orders", table({ comment: "2" }), ROOT);
    const s = await suggestRevision(ROOT, "2000-01-01T00:00:00");
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: "table", id: "orders", name: "注文" });
    expect(s.items[0].saves).toBeGreaterThanOrEqual(2);
    expect(s.text).toContain("テーブル「注文」を更新");
    expect((await suggestRevision(ROOT, "2999-01-01T00:00:00")).items).toHaveLength(0);
  });
});

describe("生成の記録と乖離の検出", () => {
  const out = (p: string) => path.join(ROOT, p);
  async function generate() {
    await fs.mkdir(out("generated"), { recursive: true });
    await fs.writeFile(out("generated/orders.ts"), "export const orders = 1;\n");
    return recordGeneration(ROOT, { outputs: [{ path: "generated/orders.ts", sources: [{ kind: "table", id: "orders" }], generator: "generate-code" }] });
  }
  it("記録した直後は最新。設計が変わると「再生成が必要」、生成物が書き換えられると「生成物が変わった」、両方なら両方、消えれば「ない」", async () => {
    expect(await generate()).toEqual({ recorded: 1, warnings: [] });
    expect((await generationStatus(ROOT)).rows[0].state).toBe("current");
    await writeTable("orders", table({ comment: "設計を変更" }), ROOT);
    expect((await generationStatus(ROOT)).rows[0]).toMatchObject({ state: "design-changed", changedSources: [{ kind: "table", id: "orders", state: "changed" }] });
    await fs.writeFile(out("generated/orders.ts"), "// 手で直した\n");
    expect((await generationStatus(ROOT)).rows[0].state).toBe("both-changed");
    await generate(); // 再生成して記録し直す
    expect((await generationStatus(ROOT)).rows[0].state).toBe("current");
    await fs.writeFile(out("generated/orders.ts"), "// 手で直した\n");
    expect((await generationStatus(ROOT)).rows[0].state).toBe("output-changed");
    await fs.rm(out("generated/orders.ts"));
    expect((await generationStatus(ROOT)).rows[0].state).toBe("output-missing");
  });
  it("設計が消えたら「削除」として示す。再生成の差分は、変わった箇所を前後の値つきで返す", async () => {
    await generate();
    await writeTable("orders", table({ comment: "追記", columns: [{ id: "id", no: 1, physicalName: "id", name: "ID", dataType: "BIGINT", primaryKey: true, notNull: true }, { id: "name", no: 2, physicalName: "name", name: "名前", dataType: "VARCHAR", length: 20 }] }), ROOT);
    const [d] = await regenerationDiff(ROOT);
    const ch = d.sources[0].changes;
    expect(d.path).toBe("generated/orders.ts");
    expect(ch.find((c) => c.path === "comment")).toMatchObject({ type: "added", after: "追記" });
    expect(ch.find((c) => c.path === "columns#name")).toMatchObject({ type: "added" });
    expect(ch.some((c) => c.path === "updatedAt")).toBe(false); // 更新日時は差分にしない
    expect(await regenerationDiff(ROOT, "other.ts")).toEqual([]);
    await fs.rm(path.join(ROOT, "harmony", "tables", "orders.json"));
    const rows = (await generationStatus(ROOT)).rows;
    expect(rows[0].changedSources[0].state).toBe("deleted");
    expect((await regenerationDiff(ROOT))[0].sources[0].state).toBe("deleted");
  });
  it("`/generate-code` の既定の出力先 (.tmp/generated-code/) を基準にして記録できる。ワークスペースの同名のファイルとは別に扱い、その外には出られない", async () => {
    const gen = await fs.mkdtemp(path.join(os.tmpdir(), "ops-gen-"));
    const prev = process.env.HARMONY_GENERATED_CODE_DIR;
    process.env.HARMONY_GENERATED_CODE_DIR = gen;
    try {
      await fs.mkdir(path.join(gen, "orders"), { recursive: true });
      await fs.writeFile(path.join(gen, "orders", "A.java"), "class A {}");
      await fs.mkdir(out("orders"), { recursive: true });
      await fs.writeFile(out("orders/A.java"), "workspace copy");
      const r = await recordGeneration(ROOT, { outputs: [{ path: "orders/A.java", base: "generated-code", sources: [{ kind: "table", id: "orders" }] }, { path: "orders/A.java", sources: [{ kind: "table", id: "orders" }] }] });
      expect(r).toEqual({ recorded: 2, warnings: [] });
      expect((await generationStatus(ROOT)).rows.map((x) => [x.base ?? "workspace", x.state])).toEqual([["generated-code", "current"], ["workspace", "current"]]);
      await fs.writeFile(path.join(gen, "orders", "A.java"), "class A { int x; }"); // 基準が違えば、別のファイル
      expect((await generationStatus(ROOT)).rows.map((x) => [x.base ?? "workspace", x.state])).toEqual([["generated-code", "output-changed"], ["workspace", "current"]]);
      // 記録し直すと、同じ (基準 + パス) だけが置き換わる
      await recordGeneration(ROOT, { outputs: [{ path: "orders/A.java", base: "generated-code", sources: [{ kind: "table", id: "orders" }] }] });
      const outputs = (await generationStore.read(ROOT)).value.outputs;
      expect(outputs).toHaveLength(2);
      expect((await generationStatus(ROOT)).rows.every((x) => x.state === "current")).toBe(true);
      await expect(recordGeneration(ROOT, { outputs: [{ path: "../x", base: "generated-code", sources: [{ kind: "table", id: "orders" }] }] })).rejects.toThrow(/場所が正しくありません/);
      await expect(recordGeneration(ROOT, { outputs: [{ path: "a.ts", base: "elsewhere", sources: [{ kind: "table", id: "orders" }] }] })).rejects.toThrow(/base は/);
    } finally {
      if (prev === undefined) delete process.env.HARMONY_GENERATED_CODE_DIR; else process.env.HARMONY_GENERATED_CODE_DIR = prev;
      await fs.rm(gen, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });
  it("外へ出る場所・絶対パス・存在しない設計・元の設計がない記録は、拒否する。ワークスペースの外のファイルは、書き換えを検出しない", async () => {
    for (const bad of ["../x.ts", "/etc/passwd", "a/../../x", ".harmony-ops/x", "a\\b"]) await expect(recordGeneration(ROOT, { outputs: [{ path: bad, sources: [{ kind: "table", id: "orders" }] }] })).rejects.toThrow(/場所が正しくありません/);
    await expect(recordGeneration(ROOT, { outputs: [{ path: "a.ts", sources: [{ kind: "table", id: "none" }] }] })).rejects.toThrow(/見つかりません/);
    await expect(recordGeneration(ROOT, { outputs: [{ path: "a.ts", sources: [] }] })).rejects.toThrow(/sources/);
    await expect(recordGeneration(ROOT, { outputs: [] })).rejects.toThrow(/outputs/);
    // ファイルが無くても記録はできる (警告つき)。シンボリックリンクの先が外なら読まない
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "ops-out-"));
    await fs.writeFile(path.join(outside, "secret.ts"), "x");
    await fs.symlink(path.join(outside, "secret.ts"), out("link.ts"));
    const r = await recordGeneration(ROOT, { outputs: [{ path: "link.ts", sources: [{ kind: "table", id: "orders" }] }, { path: "missing.ts", sources: [{ kind: "table", id: "orders" }] }] });
    expect(r.warnings).toHaveLength(2);
    expect((await generationStore.read(ROOT)).value.outputs.every((o) => o.outputHash === undefined)).toBe(true);
    await fs.rm(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
});

describe("通知の送信", () => {
  const hook: Webhook = { id: "h1", name: "t", url: "https://hooks.example.com/abc", format: "slack", events: ["approval"], enabled: true };
  const msg = { event: "approval" as const, title: "承認されました", lines: ["a"] };
  const deps = (addresses: string[], status = 200): SendDeps & { sent: unknown[] } => {
    const sent: unknown[] = [];
    return { sent, lookup: async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })), post: async (o) => { sent.push(o); return { status }; } };
  };
  it("社内・ローカルのアドレスを見分ける", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("https のみ・名前解決の結果が社内向けなら送らない (どれか 1 つでも社内向けなら拒否)。正常なら、検査したアドレスへ送る", async () => {
    expect((await sendWebhook({ ...hook, url: "http://hooks.example.com/x" }, msg, deps(["8.8.8.8"]))).ok).toBe(false);
    expect((await sendWebhook({ ...hook, url: "https://localhost/x" }, msg, deps(["8.8.8.8"]))).error).toMatch(/社内/);
    const priv = deps(["8.8.8.8", "10.0.0.1"]);
    expect((await sendWebhook(hook, msg, priv)).error).toMatch(/社内/);
    expect(priv.sent).toHaveLength(0);
    const ok = deps(["8.8.8.8"]);
    expect(await sendWebhook(hook, msg, ok)).toEqual({ ok: true, status: 200 });
    expect(ok.sent[0]).toMatchObject({ address: "8.8.8.8", timeoutMs: 10_000 });
    expect(JSON.parse((ok.sent[0] as { body: string }).body).text).toContain("承認されました");
    expect((await sendWebhook(hook, msg, deps(["8.8.8.8"], 500))).error).toMatch(/500/);
    expect((await sendWebhook(hook, msg, { lookup: async () => { throw new Error("ENOTFOUND"); }, post: async () => ({ status: 200 }) })).error).toMatch(/解決できません/);
  });
  it("そのイベントを受ける、有効な通知先にだけ送る。1 つの失敗が、ほかを止めない", async () => {
    const d = deps(["8.8.8.8"]);
    const res = await dispatchNotify([hook, { ...hook, id: "h2", events: ["comment"] }, { ...hook, id: "h3", enabled: false }, { ...hook, id: "h4", url: "https://localhost/x" }], msg, d);
    expect(res.map((r) => [r.id, r.ok])).toEqual([["h1", true], ["h4", false]]);
    expect(d.sent).toHaveLength(1);
  });
});

describe("Git 連携", () => {
  const git = (...a: string[]) => execFileSync("git", a, { cwd: ROOT, encoding: "utf-8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e" } });
  it("リポジトリでなければ、そう返す。init できる。init 後は、未追跡の変更を一覧にでき、差分も見られる", async () => {
    expect((await gitStatus(ROOT)).isRepo).toBe(false);
    await gitInit(ROOT);
    await expect(gitInit(ROOT)).rejects.toThrow(/すでに/);
    const st = await gitStatus(ROOT);
    expect(st).toMatchObject({ isRepo: true, ownRepo: true, clean: false });
    expect(st.files.map((f) => f.path)).toContain("harmony/tables/orders.json");
    expect(st.files.every((f) => f.status === "?")).toBe(true);
    // バックアップ・運用の記録の隠しフォルダは、自分の .gitignore で除かれる
    expect(st.files.some((f) => f.path.startsWith(".harmony-"))).toBe(false);
    const d = await gitDiff(ROOT, "harmony/tables/orders.json");
    expect(d.diff).toContain("+++ b/harmony/tables/orders.json");
    expect(d.diff).toContain('"physicalName": "orders"');
  });
  it("選んだファイルだけをコミットする (メッセージ必須・変更のないファイルは拒否)。コミット後は履歴に出て、差分は変更後のものになる", async () => {
    await gitInit(ROOT);
    await expect(gitCommit(ROOT, { message: " ", paths: ["harmony.json"] })).rejects.toThrow(/メッセージ/);
    await expect(gitCommit(ROOT, { message: "x", paths: [] })).rejects.toThrow(/選んで/);
    await expect(gitCommit(ROOT, { message: "x", paths: ["nothing.json"] })).rejects.toThrow(/変更のない/);
    const r = await gitCommit(ROOT, { message: "最初のコミット", paths: ["harmony.json"], actor: "花子" });
    expect(r.commit).toMatch(/^[0-9a-f]{7,}$/);
    const st = await gitStatus(ROOT);
    expect(st.files.map((f) => f.path)).not.toContain("harmony.json");
    expect(st.files.map((f) => f.path)).toContain("harmony/tables/orders.json"); // 選ばなかったものは、残る
    const log = await gitLog(ROOT);
    expect(log[0]).toMatchObject({ subject: "最初のコミット" });
    // 名前・メールが未設定でも、操作した人の名前でコミットできる (この試験では環境変数で与えているので、設定済みでない場合のみ)
    await writeTable("orders", table({ comment: "変更" }), ROOT);
    await gitCommit(ROOT, { message: "2 つ目", paths: ["harmony/tables/orders.json"] });
    await writeTable("orders", table({ comment: "また変更" }), ROOT);
    const diff = await gitDiff(ROOT, "harmony/tables/orders.json");
    expect(diff.diff).toContain("-  \"comment\": \"変更\"");
    expect(diff.diff).toContain("+  \"comment\": \"また変更\"");
  });
  it("ブランチを作って切り替えられる。変更が残っていると切り替えを拒否する。不正な名前・場所は拒否する", async () => {
    await gitInit(ROOT);
    git("add", "-A"); git("commit", "-m", "init", "--no-verify");
    expect((await gitBranches(ROOT)).filter((b) => b.current)).toHaveLength(1);
    await gitCheckout(ROOT, "feature-a", true);
    expect((await gitStatus(ROOT)).branch).toBe("feature-a");
    expect((await gitBranches(ROOT)).map((b) => b.name)).toContain("feature-a");
    await writeTable("orders", table({ comment: "未コミット" }), ROOT);
    await expect(gitCheckout(ROOT, "master")).rejects.toThrow(/コミットしていない変更/);
    for (const bad of ["-D", "a..b", "x y", "", "a;b", "--orphan", "refs/../x", "a.lock"]) expect(() => assertBranchName(bad), bad).toThrow();
    for (const bad of ["../x", "/etc/passwd", "-rf", "a\nb", "C:\\x", "a/../b", ""]) expect(() => assertGitPath(bad), bad).toThrow();
    expect(assertGitPath("harmony/tables/orders.json")).toBe("harmony/tables/orders.json");
  });
  it("他人から受け取ったリポジトリの設定 (core.fsmonitor)・フック (post-commit) が、状態の確認・コミットで実行されない", async () => {
    await gitInit(ROOT);
    const marker = path.join(ROOT, "RAN.txt");
    const script = path.join(ROOT, "evil.sh");
    await fs.writeFile(script, `#!/bin/sh\necho ran >> "${marker}"\n`, { mode: 0o755 });
    git("config", "core.fsmonitor", script);
    await fs.mkdir(path.join(ROOT, ".git", "hooks"), { recursive: true });
    for (const h of ["post-commit", "pre-commit", "commit-msg", "post-checkout"]) await fs.writeFile(path.join(ROOT, ".git", "hooks", h), `#!/bin/sh\necho ${h} >> "${marker}"\n`, { mode: 0o755 });
    await gitStatus(ROOT);
    await gitCommit(ROOT, { message: "x", paths: ["harmony.json"] });
    await gitCheckout(ROOT, "other", true).catch(() => undefined); // 未コミットの変更が残るので拒否されてよい。フックが走らないことだけを見る
    expect(await fs.access(marker).then(() => true, () => false)).toBe(false);
    // 対照: 同じ設定でも、安全の設定なしで git を直接呼ぶと、実行される (この試験が、効いていることの確認)
    git("status");
    expect(await fs.access(marker).then(() => true, () => false)).toBe(true);
  });
  it("リポジトリの設定の filter (clean / smudge)・textconv・gpg.program・include も、状態の確認・差分・コミットで実行されない", async () => {
    await gitInit(ROOT);
    git("add", "harmony.json"); git("-c", "user.name=t", "-c", "user.email=t@e", "commit", "-q", "-m", "base", "--no-verify");
    const marker = path.join(ROOT, "RAN2.txt");
    const sh = async (name: string) => { const p = path.join(ROOT, name); await fs.writeFile(p, `#!/bin/sh\necho ${name} >> "${marker}"\ncat\n`, { mode: 0o755 }); return p; };
    const clean = await sh("clean.sh"), smudge = await sh("smudge.sh"), tc = await sh("textconv.sh"), gpg = await sh("gpg.sh");
    await fs.writeFile(path.join(ROOT, ".gitattributes"), "*.json filter=evil diff=evil\n");
    const extra = path.join(ROOT, "extra.cfg");
    await fs.writeFile(extra, `[filter "evil2"]\n\tclean = ${clean}\n`);
    for (const [k, v] of [["filter.evil.clean", clean], ["filter.evil.smudge", smudge], ["diff.evil.textconv", tc], ["gpg.program", gpg], ["commit.gpgsign", "true"], ["include.path", extra]]) git("config", k, v);
    await fs.writeFile(path.join(ROOT, "harmony.json"), `${await fs.readFile(path.join(ROOT, "harmony.json"), "utf-8")} `);
    const ran = () => fs.readFile(marker, "utf-8").then((t) => t.trim().split("\n"), () => [] as string[]);
    await gitStatus(ROOT);
    await gitDiff(ROOT, "harmony.json");
    await gitCommit(ROOT, { message: "署名つきの設定でも", paths: ["harmony.json"] });
    expect(await ran()).toEqual([]);
    // 対照: 安全の設定なしで、git を直接呼ぶと、実行される (この試験が、効いていることの確認)
    await fs.writeFile(path.join(ROOT, "harmony.json"), `${await fs.readFile(path.join(ROOT, "harmony.json"), "utf-8")} `);
    git("status"); git("diff");
    expect((await ran()).length).toBeGreaterThan(0);
  });
  it("ワークツリー専用の設定 (extensions.worktreeConfig の .git/config.worktree) の filter も、実行されない", async () => {
    await gitInit(ROOT);
    git("add", "harmony.json"); git("-c", "user.name=t", "-c", "user.email=t@e", "commit", "-q", "-m", "base", "--no-verify");
    const marker = path.join(ROOT, "RAN3.txt");
    const clean = path.join(ROOT, "clean.sh");
    await fs.writeFile(clean, `#!/bin/sh\necho clean >> "${marker}"\ncat\n`, { mode: 0o755 });
    await fs.writeFile(path.join(ROOT, ".gitattributes"), "*.json filter=evil\n");
    git("config", "core.repositoryformatversion", "1"); git("config", "extensions.worktreeConfig", "true");
    await fs.writeFile(path.join(ROOT, ".git", "config.worktree"), `[filter "evil"]\n\tclean = ${clean}\n`);
    await fs.writeFile(path.join(ROOT, "harmony.json"), `${await fs.readFile(path.join(ROOT, "harmony.json"), "utf-8")} `);
    await gitStatus(ROOT);
    await gitDiff(ROOT, "harmony.json");
    expect(await fs.access(marker).then(() => true, () => false)).toBe(false);
    git("diff"); // 対照 (安全の設定なしなら、実行される)
    expect(await fs.access(marker).then(() => true, () => false)).toBe(true);
  });
  it("コマンドを実行させる設定の項目を、見分ける (includeIf・別名の入ったドライバも)", () => {
    expect(execOverrides(["user.name", "filter.lfs.clean", "diff.x.textconv", "core.fsmonitor", "merge.m.driver", "core.sshCommand", "gpg.program", "alias.x", "core.autocrlf", "diff.x.binary", "credential.https://x.helper", "url.a.insteadOf"]).filter((_, i) => i % 2 === 1)).toEqual([
      "filter.lfs.clean=", "diff.x.textconv=", "core.fsmonitor=", "merge.m.driver=", "core.sshCommand=", "credential.https://x.helper=", "url.a.insteadOf=",
    ]);
  });
  it("上の階層のリポジトリがこのフォルダを無視しているときは、「リポジトリではない」として扱う", async () => {
    const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ops-parent-")));
    execFileSync("git", ["init", "-q"], { cwd: parent });
    await fs.writeFile(path.join(parent, ".gitignore"), "ws/\n");
    const ws = path.join(parent, "ws");
    await fs.mkdir(ws);
    expect((await gitStatus(ws)).isRepo).toBe(false);
    await fs.rm(parent, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
});

describe("版の情報", () => {
  it("リリースノートの行を読む (PR 番号は任意)", () => {
    expect(parseReleaseNotes("# x\n- 2026-10-14 操作性を改善した (#1502)\n- 2026-10-13 PR 番号なし\n本文\n- 不正な行")).toEqual([{ date: "2026-10-14", title: "操作性を改善した", pr: "1502" }, { date: "2026-10-13", title: "PR 番号なし" }]);
  });
  it("版・コミット・変更の有無・リリースノートを返す。git が無くても、版は返す", async () => {
    const proj = await fs.mkdtemp(path.join(os.tmpdir(), "ops-ver-"));
    await fs.mkdir(path.join(proj, "docs"));
    await fs.writeFile(path.join(proj, "package.json"), JSON.stringify({ version: "2.3.4" }));
    await fs.writeFile(path.join(proj, "docs", "release-notes.md"), "- 2026-10-14 a (#1)\n- 2026-10-13 b (#2)\n- 2026-10-12 c\n");
    const run = async (_cwd: string, args: string[]) => {
      const key = args.join(" ");
      const out: Record<string, string> = { "rev-parse --show-toplevel": proj, "rev-parse --short HEAD": "abc1234", "rev-parse --abbrev-ref HEAD": "main", "status --porcelain --untracked-files=no": " M x" };
      return { stdout: out[key] ?? "", stderr: "", code: 0 };
    };
    const info = await readVersionInfo(run, proj, 2);
    expect(info).toMatchObject({ version: "2.3.4", commit: "abc1234", branch: "main", dirty: true, notesTotal: 3 });
    expect(info.notes).toHaveLength(2);
    const noGit = await readVersionInfo(async () => { throw new Error("git が見つかりません"); }, proj);
    expect(noGit.version).toBe("2.3.4");
    expect(noGit.commit).toBeUndefined();
    await fs.rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
});

describe("版の情報: 配布 image の build-info.json と、GitHub への更新の確認 (#1577)", () => {
  const SHA = "0123456789abcdef0123456789abcdef01234567";
  const noGit = async () => { throw new Error("git が見つかりません"); };
  let proj = "";
  beforeEach(async () => { proj = await fs.mkdtemp(path.join(os.tmpdir(), "ops-bi-")); await fs.writeFile(path.join(proj, "package.json"), JSON.stringify({ version: "9.9.9" })); });
  afterEach(async () => { await fs.rm(proj, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });
  const writeBuildInfo = (v: unknown) => fs.writeFile(path.join(proj, "build-info.json"), typeof v === "string" ? v : JSON.stringify(v));
  const gitRun = async (_cwd: string, args: string[]) => {
    const out: Record<string, string> = { "rev-parse --show-toplevel": proj, "rev-parse --short HEAD": "abc1234", "rev-parse HEAD": SHA, "rev-parse --abbrev-ref HEAD": "main", "status --porcelain --untracked-files=no": "" };
    return { stdout: out[args.join(" ")] ?? "", stderr: "", code: 0 };
  };

  it("git の作業コピーなら source は git で、完全な SHA も返す (build-info があっても git が優先)", async () => {
    await writeBuildInfo({ commit: "f".repeat(40), branch: "x" });
    expect(await readVersionInfo(gitRun, proj)).toMatchObject({ source: "git", commit: "abc1234", commitFull: SHA, branch: "main", dirty: false });
  });
  it("git の作業コピーでなければ build-info.json を読む (commit は短縮 7 桁、完全な SHA も返す)", async () => {
    await writeBuildInfo({ commit: SHA, branch: "feat/x", dirty: true, builtAt: "2026-10-30T11:23:00Z", repo: "csilost2001/harmony", extra: "無視される" });
    const info = await readVersionInfo(noGit, proj);
    expect(info).toMatchObject({ version: "9.9.9", source: "image", commit: "0123456", commitFull: SHA, branch: "feat/x", dirty: true, builtAt: "2026-10-30T11:23:00Z", repo: "csilost2001/harmony" });
    expect(info).not.toHaveProperty("extra");
  });
  it("build-info の一部の項目が空・不正でも、commit が正しければ、ほかの正しい項目だけ使う", async () => {
    await writeBuildInfo({ commit: SHA, branch: "", dirty: "true", builtAt: "いつか", repo: "../evil" });
    const info = await readVersionInfo(noGit, proj);
    expect(info).toMatchObject({ source: "image", commit: "0123456" });
    for (const k of ["branch", "dirty", "builtAt", "repo"]) expect(info, k).not.toHaveProperty(k);
  });
  it("git も build-info も無ければ、版だけ (source は無い)。壊れた build-info・commit が不正な build-info は無視する", async () => {
    const none = await readVersionInfo(noGit, proj);
    expect(none).toMatchObject({ version: "9.9.9" });
    for (const k of ["commit", "source", "commitFull"]) expect(none, k).not.toHaveProperty(k);
    for (const bad of ["{ 壊れた", "[]", "null", JSON.stringify({ commit: "abc1234" }), JSON.stringify({ commit: SHA.toUpperCase() }), JSON.stringify({ branch: "x" })]) {
      await writeBuildInfo(bad);
      expect(await readBuildInfo(proj), bad).toBeUndefined();
      expect(await readVersionInfo(noGit, proj), bad).not.toHaveProperty("source");
    }
  });

  const BI = { commit: SHA, repo: "csilost2001/harmony" };
  const reply = (status: number, body: unknown = {}) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
  const check = async (fetchFn: Parameters<typeof checkForUpdate>[2]) => { await writeBuildInfo(BI); return checkForUpdate(noGit, proj, fetchFn); };

  it("GitHub の compare に、repo と commit を入れて問い合わせる (認証なし・User-Agent つき・時間切れの signal つき)", async () => {
    let seen: { url: string; init?: { headers?: Record<string, string>; signal?: AbortSignal } } | undefined;
    await check(async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ status: "identical" }) }; });
    expect(seen?.url).toBe(`https://api.github.com/repos/csilost2001/harmony/compare/${SHA}...main?per_page=1`); // 返答を小さくするため per_page=1 (使うのは status / ahead_by / behind_by だけ)
    expect(seen?.init?.headers?.["User-Agent"]).toBeTruthy();
    expect(seen?.init?.headers?.Authorization).toBeUndefined();
    expect(seen?.init?.signal).toBeInstanceOf(AbortSignal);
  });
  it("main と同じ → current", async () => {
    expect(await check(reply(200, { status: "identical", ahead_by: 0, behind_by: 0 }))).toMatchObject({ status: "current", local: "0123456", behindBy: 0, aheadBy: 0 });
  });
  it("main が進んでいる (image が古い) → behind。compare の ahead_by は main が進んだ数", async () => {
    const r = await check(reply(200, { status: "ahead", ahead_by: 12, behind_by: 0 }));
    expect(r).toMatchObject({ status: "behind", behindBy: 12, aheadBy: 0 });
    expect(r.message).toContain("main より 12 commit 古い");
  });
  it("image の方が先 (main にない commit だけ) → current。分岐 (両方) → behind で、main にない commit の数も添える", async () => {
    expect(await check(reply(200, { status: "behind", ahead_by: 0, behind_by: 3 }))).toMatchObject({ status: "current", behindBy: 0, aheadBy: 3, message: expect.stringContaining("main より先に進んでいます") });
    const d = await check(reply(200, { status: "diverged", ahead_by: 5, behind_by: 2 }));
    expect(d).toMatchObject({ status: "behind", behindBy: 5, aheadBy: 2 });
    expect(d.message).toContain("main より 5 commit 古い");
    expect(d.message).toContain("main にない commit が 2");
  });
  it("404 → 記録した commit が GitHub に無い (push していないブランチ)。それ以外の HTTP の失敗・ネットワークの失敗・形の違う返答は unknown", async () => {
    expect(await check(reply(404))).toMatchObject({ status: "unknown", message: expect.stringContaining("記録した commit が GitHub にありません") });
    expect(await check(reply(403))).toMatchObject({ status: "unknown", message: expect.stringMatching(/確かめられません.*403/) });
    expect(await check(async () => { throw new Error("fetch failed"); })).toMatchObject({ status: "unknown", message: expect.stringContaining("確かめられません (fetch failed)") });
    expect(await check(reply(200, { status: "???" }))).toMatchObject({ status: "unknown" });
    expect(await check(async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }))).toMatchObject({ status: "unknown" });
  });
  it("build-info に repo が無い・不正な形のときは、問い合わせず unknown (URL に入れない)", async () => {
    let called = 0;
    const spy = async () => { called++; return { ok: true, status: 200, json: async () => ({}) }; };
    await writeBuildInfo({ commit: SHA });
    expect(await checkForUpdate(noGit, proj, spy)).toMatchObject({ status: "unknown", message: expect.stringContaining("取得元") });
    await writeBuildInfo({ commit: SHA, repo: "a/b/../../c" }); // 不正な repo は readBuildInfo が落とすので、repo なしと同じ扱い
    expect(await checkForUpdate(noGit, proj, spy)).toMatchObject({ status: "unknown" });
    await writeBuildInfo({ commit: "abc1234", repo: "a/b" });
    expect(await checkForUpdate(noGit, proj, spy)).toMatchObject({ status: "unknown" });
    expect(called).toBe(0);
  });
  it("git の作業コピーでも build-info も無ければ、これまでどおり確認できない旨を返す", async () => {
    expect(await checkForUpdate(noGit, proj, reply(200))).toMatchObject({ status: "unknown", message: expect.stringContaining("git の作業コピーではない") });
  });
  it("git の作業コピーは、これまでどおり origin の main と比べる", async () => {
    const run = async (_c: string, args: string[]) => {
      const k = args.join(" ");
      if (k === "rev-parse --show-toplevel") return { stdout: proj, stderr: "", code: 0 };
      if (k === "rev-parse HEAD") return { stdout: SHA, stderr: "", code: 0 };
      if (k.startsWith("ls-remote")) return { stdout: `${"1".repeat(40)}\trefs/heads/main`, stderr: "", code: 0 };
      if (k.startsWith("merge-base")) return { stdout: "", stderr: "", code: 1 };
      return { stdout: "", stderr: "", code: 0 };
    };
    expect(await checkForUpdate(run, proj, async () => { throw new Error("GitHub は使わない"); })).toMatchObject({ status: "behind", local: "0123456", remote: "1111111" });
  });
  it("harmonySummary は、版・commit・branch・dirty・source を返す (ネットワークなし)", async () => {
    expect(await harmonySummary()).toMatchObject({ version: expect.any(String) });
  });
  it("harmonySummary は 30 秒のあいだ同じ結果を覚え、30 秒後に読み直す (#1577 レビュー N10)", async () => {
    resetHarmonySummaryCache();
    const t0 = Date.now();
    const first = await harmonySummary(t0);
    expect(await harmonySummary(t0 + 29_999)).toBe(first); // 同じ object = 覚えている (git を呼び直さない)
    const later = await harmonySummary(t0 + 30_001);
    expect(later).not.toBe(first); // 読み直した
    expect(later).toEqual(first); // 中身は同じ
    expect(await harmonySummary(t0 + 30_002)).toBe(later);
    resetHarmonySummaryCache(); // 後の試験に、この試験の時刻の覚えを残さない
  });
  it("detached HEAD (git が HEAD と返す) はブランチ名とみなさない。build-info の branch が HEAD でも同じ (#1577 レビュー N1)", async () => {
    expect(branchName("HEAD\n")).toBeUndefined();
    expect(branchName(" main \n")).toBe("main");
    expect(branchName("")).toBeUndefined();
    const detached = async (_c: string, args: string[]) => {
      const out: Record<string, string> = { "rev-parse --show-toplevel": proj, "rev-parse --short HEAD": "abc1234", "rev-parse HEAD": SHA, "rev-parse --abbrev-ref HEAD": "HEAD", "status --porcelain --untracked-files=no": "" };
      return { stdout: out[args.join(" ")] ?? "", stderr: "", code: 0 };
    };
    expect(await readVersionInfo(detached, proj)).not.toHaveProperty("branch");
    await writeBuildInfo({ commit: SHA, branch: "HEAD" });
    const img = await readVersionInfo(noGit, proj);
    expect(img).toMatchObject({ source: "image", commit: "0123456" });
    expect(img).not.toHaveProperty("branch");
  });
  it("403 / 429 は回数制限の案内 (しばらくしてから)。HTTP 番号も添える (#1577 レビュー S4)", async () => {
    for (const status of [403, 429]) {
      const r = await check(reply(status));
      expect(r.status).toBe("unknown");
      expect(r.message).toContain("回数制限");
      expect(r.message).toContain(`HTTP ${status}`);
      expect(r.message).toContain("しばらくして");
    }
    expect((await check(reply(500))).message).not.toContain("回数制限"); // ほかの失敗は回数制限と言わない
  });
  it("ネットワークの失敗は cause の理由 (ENOTFOUND など) と、時間切れの案内を添える (#1577 レビュー S4)", async () => {
    const withCause = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.github.com"), { code: "ENOTFOUND", hostname: "api.github.com" }) });
    const r = await check(async () => { throw withCause; });
    expect(r.message).toContain("fetch failed");
    expect(r.message).toContain("ENOTFOUND");
    expect(r.message).toContain("api.github.com");
    expect(r.message).toContain("プロキシ");
    expect(describeFetchError(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toContain("10 秒");
    expect(describeFetchError(new Error("plain"))).toBe("plain"); // cause が無ければ message のまま
    expect(describeFetchError("x")).toBe("x");
  });
  it("更新の確認の結果は 60 秒覚える。失敗 (unknown) は覚えない。同時の問い合わせは 1 回にまとめる。鍵が違えば別 (#1577 レビュー S4)", async () => {
    let calls = 0, now = 1_000_000;
    let reply1: UpdateCheck = { status: "behind", message: "古い", behindBy: 3 };
    const memo = createUpdateCheckMemo(60_000, () => now);
    const run = () => memo("k", async () => { calls++; return reply1; });
    const [a, b] = await Promise.all([run(), run()]);
    expect(calls).toBe(1); // 同時
    expect(a).toBe(b);
    now += 59_999;
    await run();
    expect(calls).toBe(1); // 60 秒以内は覚えている
    await memo("other", async () => { calls++; return reply1; });
    expect(calls).toBe(2); // 鍵が違えば別
    now += 2;
    await run();
    expect(calls).toBe(3); // 過ぎたら問い合わせる
    reply1 = { status: "unknown", message: "失敗" };
    now += 60_001;
    await run();
    expect(calls).toBe(4);
    await run();
    expect(calls).toBe(5); // unknown は覚えない (すぐ再試行できる)
    reply1 = { status: "current", message: "最新" };
    expect((await run()).status).toBe("current");
    expect(calls).toBe(6);
  });
  it("覚えるのは配布 image の経路だけ。git の作業コピー (ls-remote) は毎回問い合わせ、git pull のあとの 2 回目は新しい結果になる (#1577 再レビュー R1)", async () => {
    const memo = createUpdateCheckMemo(60_000, () => 1);
    let head = SHA, lsRemote = 0;
    const run = async (_c: string, args: string[]) => {
      const k = args.join(" ");
      if (k === "rev-parse --show-toplevel") return { stdout: proj, stderr: "", code: 0 };
      if (k === "rev-parse HEAD") return { stdout: head, stderr: "", code: 0 };
      if (k.startsWith("ls-remote")) { lsRemote++; return { stdout: `${"1".repeat(40)}\trefs/heads/main`, stderr: "", code: 0 }; }
      if (k.startsWith("merge-base")) return { stdout: "", stderr: "", code: head === "1".repeat(40) ? 0 : 1 };
      return { stdout: "", stderr: "", code: 0 };
    };
    const noFetch = async () => { throw new Error("GitHub は使わない"); };
    expect(await checkForUpdate(run, proj, noFetch, memo)).toMatchObject({ status: "behind" });
    head = "1".repeat(40); // git pull した
    expect(await checkForUpdate(run, proj, noFetch, memo)).toMatchObject({ status: "current", message: "最新です" });
    expect(lsRemote).toBe(2);
  });
  it("配布 image の経路は、覚え (memo) を渡すと GitHub への問い合わせが 1 回になり、渡さなければ毎回問い合わせる (#1577 再レビュー R1)", async () => {
    await writeBuildInfo(BI);
    let fetched = 0;
    const f = async () => { fetched++; return { ok: true, status: 200, json: async () => ({ status: "identical" }) }; };
    const memo = createUpdateCheckMemo(60_000, () => 1);
    await checkForUpdate(noGit, proj, f, memo);
    await checkForUpdate(noGit, proj, f, memo);
    expect(fetched).toBe(1);
    await checkForUpdate(noGit, proj, f);
    await checkForUpdate(noGit, proj, f);
    expect(fetched).toBe(3);
  });
});

describe("MCP tool (AI): 生成の記録・レビューの指摘", () => {
  const call = async (name: string, args: Record<string, unknown>) => {
    const { handleDesignTool } = await import("../handlers/design.js");
    const res = await handleDesignTool(name, args, ROOT, "s") as { content: Array<{ text: string }> };
    return JSON.parse(res.content[0].text);
  };
  it("生成を記録し、設計が変わると乖離を返し、差分も返す", async () => {
    await fs.mkdir(path.join(ROOT, "gen"), { recursive: true });
    await fs.writeFile(path.join(ROOT, "gen", "a.ts"), "a");
    expect(await call("designer__record_generation", { outputs: [{ path: "gen/a.ts", sources: [{ kind: "table", id: "orders" }] }] })).toMatchObject({ recorded: 1 });
    expect(await call("designer__check_generation_drift", {})).toMatchObject({ ok: true, total: 1, needsAttention: 0 });
    await writeTable("orders", table({ comment: "変えた" }), ROOT);
    const drift = await call("designer__check_generation_drift", {});
    expect(drift).toMatchObject({ ok: false, needsAttention: 1 });
    expect(drift.rows[0].state).toBe("design-changed");
    const diff = await call("designer__get_regeneration_diff", { path: "gen/a.ts" });
    expect(diff.diffs[0].sources[0].changes.some((c: { path: string }) => c.path === "comment")).toBe(true);
  });
  it("指摘を、位置つきのレビューコメント (AI レビュー) として残す。同じ未解決の指摘は重ねない。不正な指摘は、何も残さず拒否する", async () => {
    const f = { kind: "table", id: "orders", path: "columns[0]", message: "主キーの桁数を決めてください", severity: "warning" };
    expect(await call("designer__add_review_findings", { findings: [f, { ...f, path: "columns[1]" }] })).toMatchObject({ added: 2, skippedDuplicates: 0 });
    expect(await call("designer__add_review_findings", { findings: [f] })).toMatchObject({ added: 0, skippedDuplicates: 1 });
    const open = await call("designer__list_review_comments", {});
    expect(open.total).toBe(2);
    expect(open.threads[0]).toMatchObject({ source: "ai-review", severity: "warning", status: "open", target: { kind: "table", id: "orders" } });
    await resolveThread(ROOT, "", open.threads[0].id, true);
    expect((await call("designer__list_review_comments", {})).total).toBe(1);
    expect((await call("designer__list_review_comments", { status: "all" })).total).toBe(2);
    await expect(call("designer__add_review_findings", { findings: [{ kind: "nothing", id: "x", message: "m" }] })).rejects.toThrow(/対象/);
    await expect(call("designer__add_review_findings", { findings: [] })).rejects.toThrow(/findings/);
  });
});

describe("要確認の増加の通知", () => {
  it("通知先が無ければ計算しない。あれば、増えたときだけ通知し、前回の件数を残す", async () => {
    const { checkIssueIncrease } = await import("./issuesWatch.js");
    const { notifyStore } = await import("./stores.js");
    expect(await checkIssueIncrease(ROOT)).toBeNull();
    await notifyStore.update(ROOT, () => ({ version: 1, webhooks: [{ id: "h", name: "n", url: "https://hooks.invalid/x", format: "slack", events: ["issues"], enabled: true }] }));
    const first = await checkIssueIncrease(ROOT);
    expect(first).toMatchObject({ before: null, notified: false });
    expect(JSON.parse(await fs.readFile(path.join(ROOT, ".harmony-ops", "notify-state.json"), "utf-8")).issues).toBe(first!.after);
    expect(await checkIssueIncrease(ROOT)).toMatchObject({ before: first!.after, after: first!.after, notified: false });
    // 前回の件数を 0 に戻して、増えたことにする (送信先は .invalid なので、名前解決に失敗して実際には送られない。失敗しても操作は止まらない)
    await fs.writeFile(path.join(ROOT, ".harmony-ops", "notify-state.json"), JSON.stringify({ issues: -1 }));
    expect(await checkIssueIncrease(ROOT)).toMatchObject({ before: -1, notified: true });
  });
});

describe("設計の id の改名への追従", () => {
  it("承認・コメント・生成の記録 (と、生成のときの設計の写し) の id を付け替える。ほかの設計・ほかの種類は、そのまま。改名の取り消しで戻る", async () => {
    const { renameOpsRecords } = await import("./service.js");
    await fs.mkdir(path.join(ROOT, "gen"), { recursive: true });
    await fs.writeFile(path.join(ROOT, "gen", "a.ts"), "a");
    await transitionApproval(ROOT, "", { kind: "table", id: "orders", to: "review" });
    await addComment(ROOT, "花子", { target: { kind: "table", id: "orders" }, text: "確認" });
    await recordGeneration(ROOT, { outputs: [{ path: "gen/a.ts", sources: [{ kind: "table", id: "orders" }] }] });
    const snaps = path.join(ROOT, ".harmony-ops", "gen-snapshots");
    expect((await fs.readdir(snaps))[0]).toMatch(/^table-orders-/);
    await renameOpsRecords(ROOT, "screen", "orders", "x"); // 種類が違えば、触らない
    expect((await approvalsStore.read(ROOT)).value.items[0].id).toBe("orders");
    await renameOpsRecords(ROOT, "table", "orders", "order-head");
    expect((await approvalsStore.read(ROOT)).value.items[0]).toMatchObject({ kind: "table", id: "order-head" });
    expect((await commentsStore.read(ROOT)).value.threads[0].target).toMatchObject({ kind: "table", id: "order-head" });
    expect((await generationStore.read(ROOT)).value.outputs[0].sources[0].id).toBe("order-head");
    expect((await fs.readdir(snaps))[0]).toMatch(/^table-order-head-/);
    await renameOpsRecords(ROOT, "table", "order-head", "orders"); // 取り消し
    expect((await approvalsStore.read(ROOT)).value.items[0].id).toBe("orders");
    expect((await fs.readdir(snaps))[0]).toMatch(/^table-orders-/);
    // 接頭辞が重なる id (cart / cart-item) の写しは、混ぜない
    await fs.writeFile(path.join(snaps, "table-cart-0123456789abcdef.json"), "{}");
    await fs.writeFile(path.join(snaps, "table-cart-item-0123456789abcdef.json"), "{}");
    await renameOpsRecords(ROOT, "table", "cart", "basket");
    expect((await fs.readdir(snaps)).filter((n) => n.includes("0123456789abcdef")).sort()).toEqual(["table-basket-0123456789abcdef.json", "table-cart-item-0123456789abcdef.json"]);
    await renameOpsRecords(ROOT, "pageLayout", "orders", "z"); // 対象外の種類・同じ id は、何もしない
    await renameOpsRecords(ROOT, "table", "orders", "orders");
    expect((await approvalsStore.read(ROOT)).value.items[0].id).toBe("orders");
  });
});

describe("AI の新規作成の記録の対象 (続編 第 9 弾 レビュー M1)", () => {
  it("作成の結果の文から、作られた設計の id を引く。見つからなければ undefined", () => {
    expect(createdIdFromResultText("テーブル「注文」(orders) を追加しました（ID: table-ab12cd34）")).toBe("table-ab12cd34");
    expect(createdIdFromResultText("画面「カート」を追加しました（ID: cart）")).toBe("cart");
    expect(createdIdFromResultText("ID: x1 / 別の文")).toBe("x1");
    expect(createdIdFromResultText("追加しました")).toBeUndefined();
  });
});

describe("AI の記録の対象と備考 (続編 第 9 弾 レビュー M1')", () => {
  it("引数の id が対象。ページレイアウトも。新しく作る tool は、結果の文の id。改名は、新しい id と、備考に種類", () => {
    expect(describeAiTool("designer__update_table", { tableId: "orders" }, "")).toEqual({ target: "orders" });
    expect(describeAiTool("designer__update_page_layout", { pageLayoutId: "pl1" }, "")).toEqual({ target: "pl1" });
    expect(describeAiTool("designer__add_table", { physicalName: "orders", name: "注文" }, "テーブル「注文」(orders) を追加しました（ID: table-ab12cd34）")).toEqual({ target: "table-ab12cd34" });
    expect(describeAiTool("designer__rename_entity", { entityType: "table", oldId: "a", newId: "b", apply: true }, "")).toEqual({ target: "b", detail: "table" });
    expect(describeAiTool("designer__restore_version", { resourceType: "report", id: "r1", versionId: "x" }, "")).toEqual({ target: "r1", detail: "report" });
  });
  it("編集セッションの tool は、編集セッションの「種類 id」から、対象と種類を引く", () => {
    expect(describeAiTool("editSession__save", { editSessionId: "es-1" }, "", "process-flow order-confirm")).toEqual({ target: "order-confirm", detail: "process-flow" });
    expect(describeAiTool("editSession__save", { editSessionId: "es-1" }, "", undefined)).toEqual({}); // 引けなければ、対象なし
  });
  it("予行 (apply を付けない) は、apply を持つ tool のときだけ、監査ログに残さない", () => {
    expect(isAiDryRun({}, true)).toBe(true);
    expect(isAiDryRun({ apply: false }, true)).toBe(true);
    expect(isAiDryRun({ apply: true }, true)).toBe(false);
    expect(isAiDryRun({}, false)).toBe(false);
  });

  it("編集セッションの保存は、衝突の確認だけ (checkOnly)・衝突で保存できなかったもの (ok: false) は、残さない。保存できたものだけ残す", () => {
    expect(isAiNoWrite("editSession__save", { editSessionId: "e", stage: "checkOnly" }, JSON.stringify({ ok: true }))).toBe(true);
    expect(isAiNoWrite("editSession__save", { editSessionId: "e" }, JSON.stringify({ ok: false, conflict: { changedBy: "x" } }))).toBe(true);
    expect(isAiNoWrite("editSession__save", { editSessionId: "e", stage: "commit" }, JSON.stringify({ ok: true }))).toBe(false);
    expect(isAiNoWrite("editSession__save", { editSessionId: "e" }, JSON.stringify({ ok: true }))).toBe(false);
    expect(isAiNoWrite("designer__editSession__save", { editSessionId: "e", stage: "checkOnly" }, "{}")).toBe(true);
    expect(isAiNoWrite("editSession__save", { editSessionId: "e" }, "壊れた結果")).toBe(true);
    expect(isAiNoWrite("designer__update_table", { tableId: "t" }, "{}")).toBe(false); // ほかの tool は対象外
  });
});
