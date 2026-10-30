/**
 * 連携と運用の RPC (設計書の体裁・改訂履歴・承認・レビューコメント・利用者と権限・監査ログ・通知・Git・生成の記録・版の情報)。
 * 書き込みは、役割の検査 (ops/policy.ts)・監査ログ・通知を伴う。AI (MCP) には、書き込み・外への送信の経路を渡さない (tools.ts を参照)。
 * 仕様: docs/spec/integration-ops.md
 */
import { checkWebhookUrl, cleanActor, hasAdmin, maskWebhookUrl, parseAccess, roleOf, ROLE_LABELS, type AccessFile, type NotifyEvent, type NotifyFormat, type Webhook } from "@harmony/shared";
import { recordAudit, readAudit } from "../ops/audit.js";
import { gitBranches, gitCheckout, gitCommit, gitDiff, gitInit, gitLog, gitStatus } from "../ops/gitOps.js";
import { sendWebhook } from "../ops/notifySend.js";
import { loadAccess, requireRole } from "../ops/policy.js";
import { suggestRevision } from "../ops/revisionSuggest.js";
import { addComment, emitNotify, generationStatus, listApprovals, regenerationDiff, resolveThread, transitionApproval } from "../ops/service.js";
import { accessStore, commentsStore, notifyStore, templateStore } from "../ops/stores.js";
import { scaffoldSummary } from "../ops/scaffold.js";
import { checkForUpdate, readVersionInfo } from "../ops/versionInfo.js";
import type { RpcContext, RpcHandlerMap } from "./types.js";

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const obj = (p: unknown): Record<string, unknown> => (p && typeof p === "object" ? (p as Record<string, unknown>) : {});

/** try/catch と応答を共通にする (エラーは、日本語の文のまま画面に出る) */
const h = (fn: (c: RpcContext, p: Record<string, unknown>, actor: string) => Promise<unknown>, opts: { writes?: string } = {}) => async (c: RpcContext): Promise<void> => {
  try {
    c.respond(await fn(c, obj(c.params), c.actor?.() ?? ""));
    // 書き込みのあとは、ほかの画面 (同じワークスペース) に、読み直しを促す
    if (opts.writes) c.bridge.broadcast({ wsId: c.wsId(), event: "opsChanged", data: { scope: opts.writes }, excludeClientId: c.clientId });
  } catch (e) { c.respondError(msg(e)); }
};

export const opsHandlers: RpcHandlerMap = {
  // ── 設計書の体裁・改訂履歴 ──
  "documentTemplate.load": h(async (c) => templateStore.read(c.root()).then((r) => ({ template: r.value, problems: r.problems }))),
  "documentTemplate.save": h(async (c, p, actor) => {
    const root = c.root();
    await requireRole(root, actor, "editor", "設計書の体裁を変えること");
    const r = await templateStore.update(root, () => p.template as never, { discardUnreadable: p.discardUnreadable === true });
    void recordAudit(root, { actor, action: "設計書の体裁・改訂履歴を保存した", via: "ui" });
    return { template: r.value, problems: r.problems };
  }, { writes: "template" }),
  "revisions.suggest": h(async (c, p) => {
    const root = c.root();
    const t = (await templateStore.read(root)).value;
    const lastDate = t.revisions.at(-1)?.date;
    const since = typeof p.since === "string" && /^\d{4}-\d{2}-\d{2}/.test(p.since) ? p.since : lastDate ? `${lastDate}T00:00:00` : new Date(Date.now() - 14 * 86400_000).toISOString();
    return suggestRevision(root, since);
  }),

  // ── 承認 ──
  "approvals.load": h(async (c) => listApprovals(c.root())),
  "approvals.transition": h(async (c, p, actor) => transitionApproval(c.root(), actor, p as never), { writes: "approvals" }),

  // ── レビューコメント ──
  "reviewComments.load": h(async (c) => commentsStore.read(c.root()).then((r) => ({ threads: r.value.threads, problems: r.problems }))),
  // 画面から受け取るのは、対象・本文・返信先だけ (AI の名義・種類・重大度は、画面からは指定できない。AI の指摘は MCP tool の経路)
  "reviewComments.add": h(async (c, p, actor) => addComment(c.root(), actor, { target: p.target, text: p.text, threadId: p.threadId }), { writes: "comments" }),
  "reviewComments.resolve": h(async (c, p, actor) => { await resolveThread(c.root(), actor, p.threadId, p.resolved !== false); return { ok: true }; }, { writes: "comments" }),

  // ── 利用者と権限 ──
  "access.load": h(async (c, _p, actor) => {
    const r = await accessStore.read(c.root());
    return { access: r.value, problems: r.problems, you: { name: actor, role: roleOf(r.value, actor), enforced: r.value.users.length > 0 } };
  }),
  "access.save": h(async (c, p, actor) => {
    const root = c.root();
    const cur = await loadAccess(root);
    // 設定がまだ無いときは、誰でも最初の設定ができる (そのとき、自分を管理者にする)。あるときは、管理者だけ
    if (cur.users.length > 0) await requireRole(root, actor, "admin", "利用者と権限を変えること");
    const parsed = parseAccess({ version: 1, users: p.users, policy: p.policy });
    if (parsed.problems.length) throw new Error(parsed.problems.join(" / "));
    const next: AccessFile = parsed.value;
    if (!hasAdmin(next)) throw new Error("「管理」の役割の人を、1 人以上残してください (誰も設定を変えられなくなります)");
    if (cur.users.length === 0 && next.users.length > 0 && roleOf(next, actor) !== "admin") throw new Error(`最初の設定では、あなた (「${cleanActor(actor) || "利用者名が未設定"}」) を「${ROLE_LABELS.admin}」にしてください。画面右上で利用者名を設定してから、もう一度保存してください`);
    const r = await accessStore.update(root, () => next, { discardUnreadable: p.discardUnreadable === true });
    void recordAudit(root, { actor, action: "利用者と権限を保存した", detail: `${next.users.length} 人`, via: "ui" });
    return { access: r.value, problems: r.problems };
  }, { writes: "access" }),

  // ── 監査ログ ──
  "audit.list": h(async (c, p) => readAudit(c.root(), {
    ...(typeof p.actor === "string" && p.actor ? { actor: p.actor } : {}), ...(typeof p.action === "string" && p.action ? { action: p.action } : {}), ...(typeof p.q === "string" && p.q ? { q: p.q } : {}),
    ...(typeof p.since === "string" && p.since ? { since: p.since } : {}), ...(typeof p.until === "string" && p.until ? { until: p.until } : {}), ...(typeof p.limit === "number" ? { limit: p.limit } : {}),
  })),

  // ── 通知 ──
  "notify.load": h(async (c) => {
    const r = await notifyStore.read(c.root());
    // 接続先の URL は秘密。画面にはホスト名だけを返す
    return { webhooks: r.value.webhooks.map((w) => ({ id: w.id, name: w.name, format: w.format, events: w.events, enabled: w.enabled, urlMasked: maskWebhookUrl(w.url) })), problems: r.problems };
  }),
  "notify.save": h(async (c, p, actor) => {
    const root = c.root();
    await requireRole(root, actor, "admin", "通知先を変えること");
    const list = Array.isArray(p.webhooks) ? (p.webhooks as Array<Record<string, unknown>>) : [];
    const r = await notifyStore.update(root, (f) => {
      const old = new Map(f.webhooks.map((w) => [w.id, w]));
      f.webhooks = list.map((w, i): Webhook => {
        const id = typeof w.id === "string" && w.id ? w.id : `hook-${Date.now().toString(36)}${i}`;
        const url = typeof w.url === "string" && w.url ? w.url : old.get(id)?.url ?? "";
        const bad = checkWebhookUrl(url);
        if (bad) throw new Error(`通知先「${String(w.name ?? id)}」: ${bad}`);
        return { id, name: String(w.name ?? "").trim(), url, format: w.format as NotifyFormat, events: (Array.isArray(w.events) ? w.events : []) as NotifyEvent[], enabled: w.enabled !== false };
      });
      return f;
    }, { discardUnreadable: p.discardUnreadable === true });
    void recordAudit(root, { actor, action: "通知先を保存した", detail: `${r.value.webhooks.length} 件`, via: "ui" });
    return { saved: r.value.webhooks.length };
  }, { writes: "notify" }),
  "notify.test": h(async (c, p, actor) => {
    const root = c.root();
    await requireRole(root, actor, "admin", "通知を試すこと");
    const w = (await notifyStore.read(root)).value.webhooks.find((x) => x.id === p.id);
    if (!w) throw new Error("通知先が見つかりません");
    const r = await sendWebhook(w, { event: "approval", title: "Harmony からの通知のテストです", lines: [`送信した人: ${actor || "(名前なし)"}`] });
    void recordAudit(root, { actor, action: "通知のテストを送った", target: w.name, detail: r.ok ? "成功" : r.error, via: "ui" });
    return r;
  }),

  // ── Git ──
  "git.status": h(async (c) => gitStatus(c.root())),
  "git.diff": h(async (c, p) => gitDiff(c.root(), p.path as string)),
  "git.log": h(async (c, p) => ({ commits: await gitLog(c.root(), typeof p.limit === "number" ? p.limit : 30) })),
  "git.branches": h(async (c) => ({ branches: await gitBranches(c.root()) })),
  "git.commit": h(async (c, p, actor) => {
    const root = c.root();
    await requireRole(root, actor, "editor", "コミットすること");
    // 編集中の設計 (保存していない作業コピー) があっても、コミットできるのは保存済みのファイルだけ。そのことは画面で案内する
    const r = await gitCommit(root, { message: p.message as string, paths: p.paths as string[], actor });
    void recordAudit(root, { actor, action: "Git でコミットした", target: r.commit, detail: String(p.message).slice(0, 120), via: "ui" });
    emitNotify(root, { event: "git", title: `コミットしました (${r.commit})`, lines: [`${actor || "(名前なし)"}: ${String(p.message).slice(0, 200)}`, `${r.files} ファイル`] });
    return r;
  }, { writes: "git" }),
  "git.checkout": h(async (c, p, actor) => {
    const root = c.root();
    await requireRole(root, actor, "editor", "ブランチを切り替えること");
    const r = await gitCheckout(root, p.branch as string, p.create === true);
    void recordAudit(root, { actor, action: p.create === true ? "Git でブランチを作った" : "Git でブランチを切り替えた", target: r.branch, via: "ui" });
    return r;
  }, { writes: "git" }),
  "git.init": h(async (c, _p, actor) => {
    const root = c.root();
    await requireRole(root, actor, "admin", "git のリポジトリを作ること");
    await gitInit(root);
    void recordAudit(root, { actor, action: "git init した", via: "ui" });
    return { ok: true };
  }, { writes: "git" }),

  // ── 生成の記録 (読み取り。記録は AI が MCP tool で残す) ──
  "generation.status": h(async (c) => generationStatus(c.root())),
  "generation.diff": h(async (c, p) => ({ diffs: await regenerationDiff(c.root(), typeof p.path === "string" ? p.path : undefined) })),

  // ── 版の情報 ──
  "app.version": h(async () => readVersionInfo()),
  "app.checkUpdate": h(async () => checkForUpdate()),
  // 開発コンテナの雛形の更新の状態 (読み取り。差分を取り込むのは AI が MCP tool で行う)
  "scaffold.status": h(async (c) => scaffoldSummary(c.root())),
};
