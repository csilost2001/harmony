/**
 * 連携と運用の RPC (wsHandlers/ops.ts): 画面から届く要求が、役割の検査・検証・broadcast・監査ログを通ること。
 * 運用の記録そのものの正しさは ops/ops.test.ts。ここでは、RPC の入口 (応答の形・エラーの返し方・書き込みのあとの通知) を確かめる。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { opsHandlers } from "./ops.js";
import { writeTable } from "../projectStorage.js";
import { flushAudit, readAudit } from "../ops/audit.js";
import type { RpcContext } from "./types.js";

let ROOT = "";
const ts = "2026-01-01T00:00:00.000Z";
const broadcast = vi.fn();

async function call(method: string, params: unknown = {}, actor = ""): Promise<{ ok: true; result: any } | { ok: false; error: string }> {
  const h = opsHandlers[method];
  if (!h) throw new Error(`no handler ${method}`);
  let out: { ok: true; result: any } | { ok: false; error: string } | null = null;
  const ctx: RpcContext = {
    params, clientId: "c1", root: () => ROOT, wsId: () => ROOT, actor: () => actor,
    respond: (result) => { out = { ok: true, result }; }, respondError: (error) => { out = { ok: false, error }; },
    bridge: { broadcast } as unknown as RpcContext["bridge"],
  };
  await h(ctx);
  if (!out) throw new Error(`${method}: 応答がありません`);
  return out;
}
const okResult = async (method: string, params?: unknown, actor?: string) => { const r = await call(method, params, actor); if (!r.ok) throw new Error(`${method}: ${r.error}`); return r.result; };

beforeEach(async () => {
  broadcast.mockReset();
  ROOT = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ops-rpc-")));
  await fs.mkdir(path.join(ROOT, "harmony", "tables"), { recursive: true });
  await fs.writeFile(path.join(ROOT, "harmony.json"), JSON.stringify({ schemaVersion: "v3", dataDir: "harmony", meta: { id: "00000000-0000-4000-8000-00000000000c", name: "試験", createdAt: ts, updatedAt: ts }, entities: { tables: [{ id: "orders", no: 1, name: "注文", physicalName: "orders", maturity: "draft", updatedAt: ts }] } }));
  await writeTable("orders", { id: "orders", uuid: "44444444-4444-4444-8444-444444444441", physicalName: "orders", name: "注文", createdAt: ts, updatedAt: ts, columns: [{ id: "id", no: 1, physicalName: "id", name: "ID", dataType: "BIGINT", primaryKey: true, notNull: true }] }, ROOT);
});
// 後ろで動いている書き込み (記録の追記など) と重なって、ENOTEMPTY になることがあるので、少し待って、やり直す
afterEach(async () => { await fs.rm(ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); });

describe("設計書の体裁・改訂履歴", () => {
  it("保存すると、検証して書き、読み戻せる。ほかの画面へ通知する (自分には送らない)。監査ログに残る。検証に通らなければ、書かずに理由を返す", async () => {
    const saved = await okResult("documentTemplate.save", { template: { version: 1, documentTitle: "要件定義書", excludeChapters: ["crud"], revisions: [{ version: "1.0", date: "2026-10-01", summary: "初版" }] } }, "花子");
    expect(saved.template.documentTitle).toBe("要件定義書");
    expect((await okResult("documentTemplate.load")).template.revisions).toHaveLength(1);
    expect(broadcast).toHaveBeenCalledWith({ wsId: ROOT, event: "opsChanged", data: { scope: "template" }, excludeClientId: "c1" });
    await flushAudit();
    expect((await readAudit(ROOT)).entries[0]).toMatchObject({ actor: "花子", action: "設計書の体裁・改訂履歴を保存した" });
    const bad = await call("documentTemplate.save", { template: { version: 1, accentColor: "red", excludeChapters: [], revisions: [] } });
    expect(bad.ok).toBe(false);
    expect((bad as { error: string }).error).toContain("#rrggbb");
    expect((await okResult("documentTemplate.load")).template.documentTitle).toBe("要件定義書"); // 書き換わっていない
  });

  it("改訂履歴の下書きは、前回の改訂の日付以降に保存された設計を拾う", async () => {
    await writeTable("orders", { id: "orders", uuid: "44444444-4444-4444-8444-444444444441", physicalName: "orders", name: "注文", comment: "更新", createdAt: ts, updatedAt: ts, columns: [] }, ROOT);
    const s = await okResult("revisions.suggest", { since: "2000-01-01" });
    expect(s.items[0]).toMatchObject({ kind: "table", id: "orders" });
    expect(s.text).toContain("テーブル「注文」を更新");
    expect((await okResult("revisions.suggest", { since: "2999-01-01" })).items).toEqual([]);
    expect((await okResult("revisions.suggest")).items).toBeDefined(); // 指定なし (前回の改訂がなければ 14 日前から)
  });
});

describe("承認・レビューコメント", () => {
  it("承認の操作は、状態を返し、通知し、監査ログに残す。一覧は、内容の印と突き合わせた状態を返す", async () => {
    const r = await okResult("approvals.transition", { kind: "table", id: "orders", to: "review" }, "花子");
    expect(r).toMatchObject({ state: "review", name: "注文" });
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ event: "opsChanged", data: { scope: "approvals" } }));
    const list = await okResult("approvals.load");
    expect(list.rows[0]).toMatchObject({ kind: "table", id: "orders", status: "review" });
    await flushAudit();
    expect((await readAudit(ROOT)).entries[0].action).toBe("承認の状態を「承認待ち」にした");
    const bad = await call("approvals.transition", { kind: "table", id: "orders", to: "draft2" });
    expect(bad).toEqual({ ok: false, error: "状態が正しくありません" });
  });

  it("画面からは、AI の名義・種類・重大度を指定できない (本文・対象・返信先だけを受け取る)", async () => {
    const { threadId } = await okResult("reviewComments.add", { target: { kind: "table", id: "orders" }, text: "人が書いた", ai: true, source: "ai-review", severity: "error", by: "AI レビュー" }, "花子");
    const th = (await okResult("reviewComments.load")).threads.find((t: { id: string }) => t.id === threadId);
    expect(th.source).toBeUndefined();
    expect(th.severity).toBeUndefined();
    expect(th.messages[0]).toMatchObject({ by: "花子", text: "人が書いた" });
    expect(th.messages[0].ai).toBeUndefined();
  });

  it("コメントを書き・返信し・解決できる。解決は、書き込みの通知を伴う", async () => {
    const { threadId } = await okResult("reviewComments.add", { target: { kind: "table", id: "orders", path: "columns[0]" }, text: "桁数は？" }, "花子");
    await okResult("reviewComments.add", { threadId, text: "20 です" }, "太郎");
    await okResult("reviewComments.resolve", { threadId, resolved: true }, "太郎");
    const th = (await okResult("reviewComments.load")).threads[0];
    expect(th).toMatchObject({ status: "resolved", resolvedBy: "太郎" });
    expect(th.messages).toHaveLength(2);
    await okResult("reviewComments.resolve", { threadId, resolved: false });
    expect((await okResult("reviewComments.load")).threads[0].status).toBe("open");
    expect(broadcast.mock.calls.filter((c) => c[0].data.scope === "comments").length).toBe(4);
  });
});

describe("利用者と権限", () => {
  const users = [{ name: "管理者", role: "admin" }, { name: "編集者", role: "editor" }];
  it("最初の設定は誰でもできるが、保存する人自身を「管理」にする。管理者のいない保存・名前のない保存は断る", async () => {
    const first = await call("access.save", { users, policy: { requireApprovalForCommitted: false } }, "編集者");
    expect(first.ok).toBe(false);
    expect((first as { error: string }).error).toContain("あなた (「編集者」) を「管理」にしてください");
    const noAdmin = await call("access.save", { users: [{ name: "編集者", role: "editor" }], policy: {} }, "編集者");
    expect(noAdmin.ok).toBe(false);
    expect((noAdmin as { error: string }).error).toContain("管理");
    const ok = await okResult("access.save", { users, policy: { requireApprovalForCommitted: true } }, "管理者");
    expect(ok.access.users).toHaveLength(2);
    const me = await okResult("access.load", {}, "編集者");
    expect(me.you).toEqual({ name: "編集者", role: "editor", enforced: true });
  });

  it("設定があるあとは、管理者だけが変えられる。管理者を 0 人にする保存は断る", async () => {
    await okResult("access.save", { users, policy: {} }, "管理者");
    const byEditor = await call("access.save", { users: [{ name: "編集者", role: "admin" }], policy: {} }, "編集者");
    expect(byEditor.ok).toBe(false);
    expect((byEditor as { error: string }).error).toContain("「管理」以上の役割が必要です");
    const lockout = await call("access.save", { users: [{ name: "管理者", role: "editor" }], policy: {} }, "管理者");
    expect(lockout.ok).toBe(false);
    expect((lockout as { error: string }).error).toContain("1 人以上残してください");
    // 制限をなくす (0 人) ことは、管理者ならできる
    expect((await okResult("access.save", { users: [], policy: {} }, "管理者")).access.users).toEqual([]);
  });

  it("体裁・コメントの解決・コミットは「編集」以上、通知先・git init は「管理」", async () => {
    await okResult("access.save", { users, policy: {} }, "管理者");
    const viewer = "知らない人";
    for (const [m, p] of [["documentTemplate.save", { template: { version: 1, excludeChapters: [], revisions: [] } }], ["git.commit", { message: "x", paths: ["a"] }], ["git.checkout", { branch: "x" }], ["reviewComments.resolve", { threadId: "t" }]] as const) {
      const r = await call(m, p, viewer);
      expect(r.ok, m).toBe(false);
      expect((r as { error: string }).error, m).toContain("「編集」以上の役割が必要です");
    }
    for (const [m, p] of [["notify.save", { webhooks: [] }], ["notify.test", { id: "x" }], ["git.init", {}]] as const) {
      const r = await call(m, p, "編集者");
      expect(r.ok, m).toBe(false);
      expect((r as { error: string }).error, m).toContain("「管理」以上の役割が必要です");
    }
  });
});

describe("通知先", () => {
  it("URL は返さず (ホスト名だけ)、保存済みの URL は、URL を省いた保存で保たれる。不正な URL は断る", async () => {
    const wh = { name: "チーム", url: "https://hooks.example.com/services/SECRET", format: "slack", events: ["approval"], enabled: true };
    await okResult("notify.save", { webhooks: [wh] }, "");
    const view = await okResult("notify.load");
    expect(JSON.stringify(view)).not.toContain("SECRET");
    expect(view.webhooks[0].urlMasked).toBe("https://hooks.example.com/…");
    const id = view.webhooks[0].id;
    await okResult("notify.save", { webhooks: [{ id, name: "改名", format: "teams", events: ["comment"], enabled: false }] });
    const file = JSON.parse(await fs.readFile(path.join(ROOT, ".harmony-ops", "notify.json"), "utf-8"));
    expect(file.webhooks[0]).toMatchObject({ id, name: "改名", format: "teams", url: wh.url, enabled: false }); // URL は、そのまま
    const bad = await call("notify.save", { webhooks: [{ ...wh, url: "http://hooks.example.com/x" }] });
    expect(bad).toEqual({ ok: false, error: "通知先「チーム」: https:// の URL だけ使えます" });
    expect((await call("notify.test", { id: "none" })).ok).toBe(false);
  });
});

describe("Git・生成・版", () => {
  it("git の RPC: init → 状態 → コミット → 履歴・ブランチ。リポジトリでなければ、そう返す", async () => {
    expect((await okResult("git.status")).isRepo).toBe(false);
    await okResult("git.init", {}, "");
    const st = await okResult("git.status");
    expect(st.isRepo).toBe(true);
    expect(st.files.map((f: { path: string }) => f.path)).toContain("harmony.json");
    expect((await okResult("git.diff", { path: "harmony.json" })).diff).toContain("+++ b/harmony.json");
    const commit = await okResult("git.commit", { message: "最初", paths: ["harmony.json"] }, "花子");
    expect(commit.files).toBe(1);
    expect((await okResult("git.log", { limit: 5 })).commits[0].subject).toBe("最初");
    const branch = (await okResult("git.branches")).branches.find((b: { current: boolean }) => b.current);
    expect(branch).toBeTruthy();
    execFileSync("git", ["add", "-A"], { cwd: ROOT });
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@e", "commit", "-q", "-m", "all"], { cwd: ROOT });
    await okResult("git.checkout", { branch: "feature/x", create: true });
    expect((await okResult("git.status")).branch).toBe("feature/x");
    expect((await call("git.diff", { path: "nothing" })).ok).toBe(false);
  });

  it("生成の状態・差分は、記録がなければ空。版の情報は、版と起動時刻を返す。更新の確認は、origin がなければ「unknown」を返す", async () => {
    expect(await okResult("generation.status")).toEqual({ rows: [], problems: [] });
    expect(await okResult("generation.diff", {})).toEqual({ diffs: [] });
    const v = await okResult("app.version");
    expect(v.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof v.startedAt).toBe("string");
    expect(["current", "behind", "unknown"]).toContain((await okResult("app.checkUpdate")).status);
  });

  it("変更の記録の絞り込みの引数を受け取る", async () => {
    await okResult("approvals.transition", { kind: "table", id: "orders", to: "review" }, "花子");
    await flushAudit();
    const r = await okResult("audit.list", { actor: "花子", action: "承認", q: "注文", since: "2000-01-01", until: "2999-01-01", limit: 10 });
    expect(r.total).toBe(1);
    expect((await okResult("audit.list", { actor: "誰か" })).total).toBe(0);
  });
});
