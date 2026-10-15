/**
 * 運用の記録の操作 (承認・レビューコメント・生成の記録・通知)。RPC (画面) と MCP tool (AI) の両方が使う。
 * 書き込みは、役割の検査・監査ログ・通知を伴う。
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  allowedTransitions, cleanActor, computeDrift, effectiveStatus, isOpsEntityKind, isSafeRelPath, jsonDiff, MAX_APPROVAL_HISTORY, MAX_COMMENT_CHARS, MAX_GEN_SOURCES, MAX_MESSAGES_PER_THREAD, MAX_THREADS,
  OPS_ENTITY_LABELS, STATUS_LABELS, transitionNeeds, GEN_BASES,
  type Approval, type ApprovalState, type ApprovalStatus, type CommentTarget, type DriftRow, type GenBase, type GenOutput, type GenSource, type JsonChange, type NotifyMessage, type OpsEntityKind,
} from "@harmony/shared";
import { entityHash, readEntityJson, sha256 } from "./entityHash.js";
import { recordAudit } from "./audit.js";
import { dispatchNotify } from "./notifySend.js";
import { ensureHiddenDir, opsDirOf } from "./opsFiles.js";
import { PermissionError, requireRole } from "./policy.js";
import { accessStore, approvalsStore, commentsStore, generationStore, notifyStore } from "./stores.js";

const rid = (p: string): string => `${p}-${crypto.randomBytes(5).toString("hex")}`;

async function projectName(root: string): Promise<string | undefined> {
  try { const j = JSON.parse(await fs.readFile(path.join(root, "harmony.json"), "utf-8")) as { meta?: { name?: unknown } }; return typeof j.meta?.name === "string" ? j.meta.name : undefined; } catch { return undefined; }
}

/** 通知 (失敗しても、元の操作は止めない。待たない) */
export function emitNotify(root: string, message: Omit<NotifyMessage, "projectName">): void {
  void (async () => {
    const { value } = await notifyStore.read(root);
    if (!value.webhooks.some((w) => w.enabled && w.events.includes(message.event))) return;
    await dispatchNotify(value.webhooks, { ...message, projectName: await projectName(root) });
  })().catch(() => undefined);
}

const nameOfEntity = async (root: string, kind: OpsEntityKind, id: string): Promise<string> => {
  const j = (await readEntityJson(root, kind, id).catch(() => null)) as { name?: unknown; meta?: { name?: unknown } } | null;
  const n = j && (typeof j.name === "string" ? j.name : typeof j.meta?.name === "string" ? j.meta.name : "");
  return n || id;
};

// ── 承認 ─────────────────────────────────────────────────────────────────

export interface ApprovalRow extends Approval { status: ApprovalStatus; name: string; nextStates: Array<{ to: ApprovalState; needs: string }> }

export async function listApprovals(root: string): Promise<{ rows: ApprovalRow[]; problems: string[] }> {
  const { value, problems } = await approvalsStore.read(root);
  const rows: ApprovalRow[] = [];
  for (const a of value.items) {
    const h = await entityHash(root, a.kind, a.id).catch(() => null);
    const status = effectiveStatus(a, h);
    rows.push({ ...a, status, name: await nameOfEntity(root, a.kind, a.id), nextStates: allowedTransitions(a.state).map((t) => ({ to: t.to, needs: t.needs })) });
  }
  return { rows, problems };
}

export async function transitionApproval(root: string, actorRaw: unknown, p: { kind: unknown; id: unknown; to: unknown; note?: unknown }): Promise<ApprovalRow> {
  const actor = cleanActor(actorRaw);
  if (!isOpsEntityKind(p.kind) || typeof p.id !== "string") throw new Error("設計の種類と id を指定してください");
  const to = p.to as ApprovalState;
  if (!["draft", "review", "approved", "rejected"].includes(to)) throw new Error("状態が正しくありません");
  const note = typeof p.note === "string" ? p.note.trim().slice(0, 1000) : "";
  const hash = await entityHash(root, p.kind, p.id);
  if (!hash) throw new Error(`${OPS_ENTITY_LABELS[p.kind]}「${p.id}」が見つかりません`);
  const kind = p.kind, id = p.id;
  let result: Approval | undefined;
  await approvalsStore.update(root, async (f) => {
    const cur = f.items.find((a) => a.kind === kind && a.id === id);
    const from: ApprovalState = cur?.state ?? "draft";
    const needs = transitionNeeds(from, to);
    if (!needs) throw new Error(`「${STATUS_LABELS[from]}」から「${STATUS_LABELS[to]}」へは、変えられません`);
    await requireRole(root, actor, needs, `「${STATUS_LABELS[to]}」にすること`);
    if (to === "rejected" && !note) throw new Error("差し戻しには、理由を書いてください");
    const event = { state: to, by: actor || "(名前なし)", at: new Date().toISOString(), ...(note ? { note } : {}) };
    const next: Approval = { kind, id, state: to, ...(to === "approved" ? { hash } : {}), history: [...(cur?.history ?? []), event].slice(-MAX_APPROVAL_HISTORY) };
    f.items = cur ? f.items.map((a) => (a === cur ? next : a)) : [...f.items, next];
    result = next;
    return f;
  });
  const name = await nameOfEntity(root, kind, id);
  void recordAudit(root, { actor, action: `承認の状態を「${STATUS_LABELS[to]}」にした`, target: `${OPS_ENTITY_LABELS[kind]} ${name} (${id})`, ...(note ? { detail: note } : {}), via: "ui" });
  emitNotify(root, { event: "approval", title: `${OPS_ENTITY_LABELS[kind]}「${name}」が「${STATUS_LABELS[to]}」になりました`, lines: [`操作した人: ${actor || "(名前なし)"}`, ...(note ? [`メモ: ${note}`] : [])] });
  return { ...result!, status: to, name, nextStates: allowedTransitions(to).map((t) => ({ to: t.to, needs: t.needs })) };
}

// ── レビューコメント ───────────────────────────────────────────────────────

export async function addComment(root: string, actorRaw: unknown, p: { target?: unknown; text?: unknown; threadId?: unknown; ai?: boolean; severity?: unknown; source?: "human" | "ai-review"; /** false で、通知を出さない (まとめて 1 通にするとき) */ notify?: boolean }): Promise<{ threadId: string }> {
  const actor = cleanActor(actorRaw);
  const text = typeof p.text === "string" ? p.text.trim() : "";
  if (!text) throw new Error("コメントを書いてください");
  if (text.length > MAX_COMMENT_CHARS) throw new Error(`コメントが長すぎます (${MAX_COMMENT_CHARS} 文字まで)`);
  if (!p.ai) await requireRole(root, actor, "viewer", "コメントすること");
  let threadId = typeof p.threadId === "string" ? p.threadId : "";
  let target: CommentTarget | undefined;
  if (!threadId) {
    const t = p.target as Partial<CommentTarget> | undefined;
    if (!t || !isOpsEntityKind(t.kind) || typeof t.id !== "string") throw new Error("コメントの対象 (設計の種類と id) を指定してください");
    if (!(await entityHash(root, t.kind, t.id))) throw new Error(`${OPS_ENTITY_LABELS[t.kind]}「${t.id}」が見つかりません`);
    target = { kind: t.kind, id: t.id, ...(typeof t.path === "string" && t.path.trim() ? { path: t.path.trim().slice(0, 300) } : {}) };
    threadId = rid("t");
  }
  const by = p.ai ? "AI レビュー" : actor || "(名前なし)";
  await commentsStore.update(root, (f) => {
    const msg = { id: rid("m"), by, at: new Date().toISOString(), text, ...(p.ai ? { ai: true as const } : {}) };
    const th = f.threads.find((x) => x.id === threadId);
    if (th) {
      if (th.messages.length >= MAX_MESSAGES_PER_THREAD) throw new Error(`このスレッドのコメントが多すぎます (${MAX_MESSAGES_PER_THREAD} 件まで)`);
      th.messages.push(msg);
      if (th.status === "resolved") { th.status = "open"; delete th.resolvedBy; delete th.resolvedAt; }
    } else {
      if (!target) throw new Error("スレッドが見つかりません");
      if (f.threads.length >= MAX_THREADS) throw new Error(`スレッドが多すぎます (${MAX_THREADS} 件まで)。解決済みのものを整理してください`);
      f.threads.push({ id: threadId, target, status: "open", ...(p.source === "ai-review" ? { source: "ai-review" as const } : {}), ...(p.severity === "error" || p.severity === "warning" || p.severity === "info" ? { severity: p.severity } : {}), messages: [msg] });
    }
    return f;
  });
  const tgt = target ?? (await commentsStore.read(root)).value.threads.find((t) => t.id === threadId)?.target;
  const label = tgt ? `${OPS_ENTITY_LABELS[tgt.kind]} ${await nameOfEntity(root, tgt.kind, tgt.id)}${tgt.path ? ` / ${tgt.path}` : ""}` : "";
  void recordAudit(root, { actor: by, action: p.threadId ? "コメントに返信した" : "コメントを書いた", target: label, detail: text.slice(0, 120), via: p.ai ? "ai" : "ui" });
  if (p.notify !== false) emitNotify(root, { event: "comment", title: `${label} にコメントがありました`, lines: [`${by}: ${text.slice(0, 200)}`] });
  return { threadId };
}

export async function resolveThread(root: string, actorRaw: unknown, threadId: unknown, resolved: boolean): Promise<void> {
  const actor = cleanActor(actorRaw);
  await requireRole(root, actor, "editor", resolved ? "コメントを解決済みにすること" : "コメントを開き直すこと");
  if (typeof threadId !== "string") throw new Error("スレッドを指定してください");
  await commentsStore.update(root, (f) => {
    const th = f.threads.find((t) => t.id === threadId);
    if (!th) throw new Error("スレッドが見つかりません");
    if (resolved) { th.status = "resolved"; th.resolvedBy = actor || "(名前なし)"; th.resolvedAt = new Date().toISOString(); } else { th.status = "open"; delete th.resolvedBy; delete th.resolvedAt; }
    return f;
  });
  void recordAudit(root, { actor, action: resolved ? "コメントを解決済みにした" : "コメントを開き直した", target: threadId, via: "ui" });
}

// ── 生成の記録 ───────────────────────────────────────────────────────────

const MAX_OUTPUT_BYTES = 50 * 1024 * 1024;
const snapDir = (root: string): string => path.join(opsDirOf(root), "gen-snapshots");
const snapFile = (root: string, s: GenSource): string => path.join(snapDir(root), `${s.kind}-${s.id}-${s.hash.slice(0, 16)}.json`);

/** `/generate-code` の既定の出力先 (本体の `.tmp/generated-code/`)。試験・特別な配置では、環境変数 HARMONY_GENERATED_CODE_DIR で変える */
export const generatedCodeRoot = (): string => path.resolve(process.env.HARMONY_GENERATED_CODE_DIR || path.join(import.meta.dirname, "../../../.tmp/generated-code"));
const baseDir = (root: string, base: GenBase | undefined): string => (base === "generated-code" ? generatedCodeRoot() : root);

async function outputHash(root: string, rel: string, genBase?: GenBase): Promise<string | null> {
  const top = baseDir(root, genBase);
  const abs = path.resolve(top, rel);
  if (abs !== top && !abs.startsWith(path.resolve(top) + path.sep)) return null;
  try {
    // シンボリックリンクの先が基準の外なら、読まない
    const real = await fs.realpath(abs);
    const base = await fs.realpath(top);
    if (real !== base && !real.startsWith(base + path.sep)) return null;
    const st = await fs.stat(real);
    if (!st.isFile() || st.size > MAX_OUTPUT_BYTES) return null;
    return sha256(await fs.readFile(real));
  } catch { return null; }
}

export interface RecordGenerationInput { outputs: Array<{ path: unknown; base?: unknown; sources?: unknown; generator?: unknown; note?: unknown }> }

export async function recordGeneration(root: string, input: RecordGenerationInput, actor = "AI"): Promise<{ recorded: number; warnings: string[] }> {
  if (!Array.isArray(input.outputs) || !input.outputs.length) throw new Error("outputs (生成したファイルの一覧) を指定してください");
  if (input.outputs.length > 500) throw new Error("一度に記録できるのは 500 ファイルまでです");
  const warnings: string[] = [];
  const entries: GenOutput[] = [];
  for (const o of input.outputs) {
    if (!isSafeRelPath(o.path)) throw new Error(`ファイルの場所が正しくありません (ワークスペースからの相対パスで書いてください): ${String(o.path)}`);
    const rawSources = Array.isArray(o.sources) ? o.sources : [];
    if (!rawSources.length) throw new Error(`${o.path}: sources (元にした設計) を指定してください`);
    if (rawSources.length > MAX_GEN_SOURCES) throw new Error(`${o.path}: 元にした設計が多すぎます (${MAX_GEN_SOURCES} 件まで)`);
    const sources: GenSource[] = [];
    for (const s of rawSources as Array<{ kind?: unknown; id?: unknown }>) {
      if (!isOpsEntityKind(s.kind) || typeof s.id !== "string") throw new Error(`${o.path}: 元にした設計の指定が正しくありません`);
      const content = await readEntityJson(root, s.kind, s.id);
      if (content === null) throw new Error(`${o.path}: ${OPS_ENTITY_LABELS[s.kind]}「${s.id}」が見つかりません`);
      const src: GenSource = { kind: s.kind, id: s.id, hash: (await entityHash(root, s.kind, s.id))! };
      await fs.mkdir(snapDir(root), { recursive: true });
      await ensureHiddenDir(root);
      await fs.writeFile(snapFile(root, src), JSON.stringify(content), { flag: "w", encoding: "utf-8" });
      sources.push(src);
    }
    if (o.base !== undefined && !(GEN_BASES as readonly string[]).includes(o.base as string)) throw new Error(`${o.path}: base は ${GEN_BASES.join(" / ")} のどちらかです`);
    const genBase = o.base === "generated-code" ? ("generated-code" as const) : undefined;
    const oh = await outputHash(root, o.path, genBase);
    if (oh === null) warnings.push(`${o.path}: ファイルが見つからないか、${genBase ? ".tmp/generated-code/" : "ワークスペース"}の外にあります (生成物の書き換えは検出しません)`);
    entries.push({ path: o.path, ...(genBase ? { base: genBase } : {}), sources, at: new Date().toISOString(), ...(oh ? { outputHash: oh } : {}), ...(typeof o.generator === "string" && o.generator ? { generator: o.generator.slice(0, 100) } : {}), ...(typeof o.note === "string" && o.note ? { note: o.note.slice(0, 500) } : {}) });
  }
  await generationStore.update(root, (f) => {
    for (const e of entries) f.outputs = [...f.outputs.filter((x) => !(x.path === e.path && (x.base ?? "workspace") === (e.base ?? "workspace"))), e];
    return f;
  });
  void recordAudit(root, { actor, action: "生成の記録を残した", detail: `${entries.length} ファイル`, via: "ai" });
  return { recorded: entries.length, warnings };
}

export async function generationStatus(root: string): Promise<{ rows: DriftRow[]; problems: string[] }> {
  const { value, problems } = await generationStore.read(root);
  const current = new Map<string, string>();
  const need = new Set(value.outputs.flatMap((o) => o.sources.map((s) => `${s.kind}:${s.id}`)));
  for (const key of need) {
    const [kind, ...rest] = key.split(":");
    const h = await entityHash(root, kind as OpsEntityKind, rest.join(":")).catch(() => null);
    if (h) current.set(key, h);
  }
  const outHashes = new Map<string, string | null>();
  const keyOf = (o: { path: string; base?: GenBase }) => `${o.base ?? "workspace"}:${o.path}`;
  for (const o of value.outputs) outHashes.set(keyOf(o), await outputHash(root, o.path, o.base));
  return { rows: computeDrift(value, current, (o) => outHashes.get(keyOf(o)) ?? null), problems };
}

export interface RegenDiff { path: string; sources: Array<{ kind: OpsEntityKind; id: string; state: "changed" | "deleted" | "no-snapshot"; changes: JsonChange[]; truncated: boolean }> }

/** 生成のときの設計と、いまの設計の差 (どこが変わったか)。再生成の範囲を絞る材料 */
export async function regenerationDiff(root: string, filePath?: string): Promise<RegenDiff[]> {
  const { rows } = await generationStatus(root);
  const gen = (await generationStore.read(root)).value;
  const out: RegenDiff[] = [];
  for (const row of rows) {
    if (filePath && row.path !== filePath) continue;
    if (!row.changedSources.length) continue;
    const rec = gen.outputs.find((o) => o.path === row.path)!;
    const sources: RegenDiff["sources"] = [];
    for (const cs of row.changedSources) {
      const recorded = rec.sources.find((s) => s.kind === cs.kind && s.id === cs.id)!;
      let before: unknown = null;
      try { before = JSON.parse(await fs.readFile(snapFile(root, recorded), "utf-8")); } catch { /* 写しが無い */ }
      if (cs.state === "deleted") { sources.push({ kind: cs.kind, id: cs.id, state: "deleted", changes: [], truncated: false }); continue; }
      if (before === null) { sources.push({ kind: cs.kind, id: cs.id, state: "no-snapshot", changes: [], truncated: false }); continue; }
      const now = await readEntityJson(root, cs.kind, cs.id);
      const d = jsonDiff(before, now);
      sources.push({ kind: cs.kind, id: cs.id, state: "changed", ...d });
    }
    out.push({ path: row.path, sources });
  }
  return out;
}

export { accessStore, PermissionError };


// ── 設計の id の改名への追従 ─────────────────────────────────────────────

const RENAME_KIND: Record<string, OpsEntityKind> = { screen: "screen", table: "table", processFlow: "processFlow", sequence: "sequence", view: "view", viewDefinition: "viewDefinition" };

/**
 * 設計の id の改名 (と、その取り消し) に、運用の記録 (承認・レビューコメント・生成の記録と、生成のときの設計の写し) の id を追従させる。
 * 改名は、設計の内容 (id) を変えるので、承認は「承認後に変更」、生成は「設計が変わった」と示される (確かめ直す合図)。記録の付け替えに失敗しても、改名は止めない。
 */
export async function renameOpsRecords(root: string, entityType: string, from: string, to: string): Promise<void> {
  const kind = RENAME_KIND[entityType];
  if (!kind || from === to) return;
  const swap = <T extends { kind: string; id: string }>(x: T): T => (x.kind === kind && x.id === from ? { ...x, id: to } : x);
  try {
    await approvalsStore.update(root, (f) => { f.items = f.items.map(swap); return f; });
    await commentsStore.update(root, (f) => { f.threads = f.threads.map((t) => (t.target.kind === kind && t.target.id === from ? { ...t, target: { ...t.target, id: to } } : t)); return f; });
    await generationStore.update(root, (f) => { f.outputs = f.outputs.map((o) => ({ ...o, sources: o.sources.map(swap) })); return f; });
    const dir = snapDir(root);
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      const prefix = `${kind}-${from}-`;
      // 残りが「ハッシュ 16 桁 + .json」のものだけ (id にはハイフンが入るので、`cart` の接頭辞が `cart-item` の写しにも当たる)
      if (name.startsWith(prefix) && /^[0-9a-f]{16}\.json$/.test(name.slice(prefix.length))) await fs.rename(path.join(dir, name), path.join(dir, `${kind}-${to}-${name.slice(prefix.length)}`)).catch(() => undefined);
    }
  } catch { /* 記録が壊れている (読めない項目がある) ときは、そのまま。点検が知らせる */ }
}
