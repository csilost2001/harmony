/**
 * 設計全体の検索置換。設計の「表示の文章」(名前・ラベル・説明・備考など) から語を探し、選んだものだけを置き換える。
 *
 * - 置換するのは、人が読む文章の欄だけ (REPLACE_KEYS)。ID・参照・物理名・式・SQL・条件式には触れない
 *   (ID の変更は「ID の変更」(参照も一緒に直る) を使う)。`@` で始まる参照つきの文言、識別子だけの `name` も飛ばす
 * - 予行 (preview) は何も書かない。適用 (apply) は、選んだ項目を再走査して、いまも同じ文言のものだけを書き換える
 *   (予行のあとに変えられたものは飛ばす)。編集中の設計は飛ばす (あとの保存で、置換が巻き戻るため)
 * - 書き換える前の内容は、ファイルの世代 (.harmony-backups) と、取り消し用の記録 (30 分) の両方に残す。
 *   取り消しは、置換したあとで変えられていないファイルだけ元に戻す
 * - 複数ファイルの書き換えは、途中で止まっても戻せるよう、先に記録 (.harmony-journal) を残す
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { harmonyFile, resolveDataRoot, writeJSON } from "./storageCore.js";
import { acquireWorkspaceLock } from "./renameLock.js";
import { openJournal, planFromAbsolute } from "./operationJournal.js";
import { backupBeforeOverwrite } from "./fileBackup.js";
import { GENERIC_DEFINITION_KINDS } from "./designSearch.js";

export type ReplaceKind =
  | "screen" | "table" | "process-flow" | "business-flow" | "report" | "sequence" | "view" | "view-definition" | "page-layout" | "generic-definition";

/** 置換の対象にする欄の名前 (人が読む文章)。physicalName・path・condition(s)・expression・sql・defaultValue・id・ref 類は含めない */
export const REPLACE_KEYS: ReadonlySet<string> = new Set([
  "name", "label", "description", "comment", "title", "message", "note", "text", "purpose", "placeholder", "helperText",
]);
/** 汎用定義の `name` は、ファイル名・参照に使う識別子なので、置換しない */
const KEYS_NOT_FOR_GENERIC: ReadonlySet<string> = new Set(["name"]);
/** 識別子だけの文字列 (変数名・パラメータ名など)。`name` の欄では、置換しない */
const IDENTIFIER_LIKE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

export const QUERY_MAX = 200;
export const REPLACEMENT_MAX = 500;
/** 予行で返す候補の上限 (超えたら truncated)。適用は上限なし (選んだ key だけ) */
export const PREVIEW_MAX = 2000;
export const SELECT_MAX = 20000;
const UNDO_TTL_MS = 30 * 60 * 1000;
const UNDO_MAX_PER_WORKSPACE = 5;

export interface ReplaceOptions { query: string; replacement: string; caseSensitive: boolean }

export interface ReplaceCandidate {
  /** 候補の識別 (`<種類>:<ID>#<JSON のパス>`)。適用で選ぶのに使う */
  key: string;
  kind: ReplaceKind;
  id: string;
  /** 設計の名前 (表示用) */
  entityName: string;
  /** どの欄か (例: 「カラム 注文ID › 備考」) */
  where: string;
  before: string;
  after: string;
}

export interface ReplacePreview {
  candidates: ReplaceCandidate[];
  /** 見つかった候補の総数 (candidates が上限で切れていても、総数) */
  total: number;
  truncated: boolean;
  /** 候補のある設計 (編集中のものを含む) の数 */
  entities: number;
  /** 編集中で、置換できない設計 (種類 / ID → 理由) */
  blocked: Array<{ kind: ReplaceKind; id: string; reason: string }>;
}

/** 設計が編集中なら、その理由。なければ null (呼び出し側が、編集セッションの状況から答える) */
export type BlockedCheck = (kind: ReplaceKind, id: string) => string | null;

// ── 登録簿 (harmony.json) ──

/** 一覧が読む登録簿 (harmony.json の entities) の項目。名前を持つ設計は、設計のファイルと登録簿の両方の名前を直さないと、一覧・クイックオープン・タブの題だけが古いままになる */
const REGISTRY_KEY: Partial<Record<ReplaceKind, string>> = {
  "screen": "screens", "table": "tables", "process-flow": "processFlows", "sequence": "sequences", "view": "views",
  "view-definition": "viewDefinitions", "page-layout": "pageLayouts",
};

/** 登録簿の名前に映る欄 (処理フローは meta.name、ほかは name) か */
function isRegistryName(kind: ReplaceKind, ptr: string): boolean {
  return REGISTRY_KEY[kind] !== undefined && ptr === (kind === "process-flow" ? "meta/name" : "name");
}

// ── 走査 ────────────────────────────────────────────────────────────────

const KEY_LABELS: Record<string, string> = {
  name: "名前", label: "ラベル", description: "説明", comment: "備考", title: "見出し", message: "メッセージ", note: "付箋", text: "文言",
  purpose: "目的", placeholder: "入力例", helperText: "補足", meta: "基本情報",
};
const ARRAY_LABELS: Record<string, string> = {
  columns: "カラム", items: "項目", actions: "アクション", steps: "工程", subSteps: "工程", branches: "分岐", fields: "項目",
  constraints: "制約", indexes: "インデックス", lanes: "レーン", rules: "ルール", inputs: "入力", outputs: "出力", sections: "区画",
  notes: "付箋", markers: "マーカー", nodes: "部品", children: "部品", options: "選択肢",
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const escapePtr = (s: string) => s.replace(/~/g, "~0").replace(/\//g, "~1");
const unescapePtr = (s: string) => s.replace(/~1/g, "/").replace(/~0/g, "~");

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

export function buildMatcher(opts: ReplaceOptions): RegExp {
  return new RegExp(escapeRegExp(opts.query), opts.caseSensitive ? "g" : "gi");
}

function assertOptions(opts: ReplaceOptions): void {
  if (typeof opts.query !== "string" || opts.query.length === 0) throw new Error("探す語を入れてください");
  if (opts.query.length > QUERY_MAX) throw new Error(`探す語は ${QUERY_MAX} 文字までです`);
  if (typeof opts.replacement !== "string") throw new Error("置き換える語が文字列ではありません");
  if (opts.replacement.length > REPLACEMENT_MAX) throw new Error(`置き換える語は ${REPLACEMENT_MAX} 文字までです`);
}

/** 置換してよい欄か (値の形も見る) */
function replaceable(kind: ReplaceKind, key: string, value: string): boolean {
  if (!REPLACE_KEYS.has(key)) return false;
  if (kind === "generic-definition" && KEYS_NOT_FOR_GENERIC.has(key)) return false;
  if (value.trimStart().startsWith("@")) return false; // 参照つきの文言 (@msg.* / @conv.* など)
  if (key === "name" && IDENTIFIER_LIKE.test(value)) return false;
  return true;
}

interface Found { ptr: string; where: string; value: string }

function scanEntity(kind: ReplaceKind, entity: unknown, re: RegExp): Found[] {
  const out: Found[] = [];
  const walk = (node: unknown, ptr: string[], where: string) => {
    if (Array.isArray(node)) {
      node.forEach((el, i) => walk(el, [...ptr, String(i)], where));
      return;
    }
    if (!isRecord(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === "string") {
        if (!replaceable(kind, k, v)) continue;
        re.lastIndex = 0;
        if (!re.test(v)) continue;
        out.push({ ptr: [...ptr, k].map(escapePtr).join("/"), where: `${where ? `${where} › ` : ""}${KEY_LABELS[k] ?? k}`, value: v });
      } else if (Array.isArray(v)) {
        v.forEach((el, i) => {
          if (isRecord(el)) {
            const ident = [el.label, el.name, el.physicalName, el.id].find((x) => typeof x === "string" && x) as string | undefined;
            walk(el, [...ptr, k, String(i)], `${where ? `${where} › ` : ""}${ARRAY_LABELS[k] ?? k} ${ident ?? i + 1}`);
          } else if (Array.isArray(el)) walk(el, [...ptr, k, String(i)], where);
        });
      } else if (isRecord(v)) {
        walk(v, [...ptr, k], k === "meta" ? where : `${where ? `${where} › ` : ""}${KEY_LABELS[k] ?? k}`);
      }
    }
  };
  walk(entity, [], "");
  return out;
}

function getAt(root: unknown, ptr: string): unknown {
  let cur: unknown = root;
  for (const seg of ptr.split("/").map(unescapePtr)) {
    if (Array.isArray(cur)) cur = cur[Number(seg)];
    else if (isRecord(cur)) cur = Object.hasOwn(cur, seg) ? cur[seg] : undefined;
    else return undefined;
  }
  return cur;
}

function setAt(root: unknown, ptr: string, value: string): boolean {
  const segs = ptr.split("/").map(unescapePtr);
  let cur: unknown = root;
  for (let i = 0; i < segs.length - 1; i++) {
    if (Array.isArray(cur)) cur = cur[Number(segs[i])];
    else if (isRecord(cur) && Object.hasOwn(cur, segs[i])) cur = cur[segs[i]];
    else return false;
  }
  const last = segs[segs.length - 1];
  if (Array.isArray(cur)) { cur[Number(last)] = value; return true; }
  if (isRecord(cur) && Object.hasOwn(cur, last)) { cur[last] = value; return true; }
  return false;
}

// ── ファイルの列挙 ──────────────────────────────────────────────────────

interface TargetFile { kind: ReplaceKind; id: string; abs: string; rel: string }

const KIND_DIRS: ReadonlyArray<[ReplaceKind, string]> = [
  ["screen", "screens"], ["table", "tables"], ["process-flow", "process-flows"], ["business-flow", "business-flows"], ["report", "reports"],
  ["sequence", "sequences"], ["view", "views"], ["view-definition", "view-definitions"], ["page-layout", "page-layouts"],
];

async function listJson(dir: string): Promise<string[]> {
  try {
    return (await fs.readdir(dir)).filter((n) => n.endsWith(".json") && !n.startsWith(".") && !n.includes(".design.") && !n.includes("puck-data")).sort();
  } catch { return []; }
}

async function listTargets(dataRoot: string): Promise<TargetFile[]> {
  const out: TargetFile[] = [];
  for (const [kind, dir] of KIND_DIRS) {
    for (const n of await listJson(path.join(dataRoot, dir))) out.push({ kind, id: n.slice(0, -5), abs: path.join(dataRoot, dir, n), rel: `${dir}/${n}` });
  }
  for (const gk of GENERIC_DEFINITION_KINDS) {
    const dir = path.join("generic-definitions", gk);
    for (const n of await listJson(path.join(dataRoot, dir))) out.push({ kind: "generic-definition", id: `${gk}/${n.slice(0, -5)}`, abs: path.join(dataRoot, dir, n), rel: `${dir.split(path.sep).join("/")}/${n}` });
  }
  return out;
}

async function readJsonFile(abs: string): Promise<{ text: string; data: unknown } | null> {
  let text: string;
  try { text = await fs.readFile(abs, "utf-8"); } catch { return null; }
  try { return { text, data: JSON.parse(text) }; } catch { return null; } // 壊れたファイルは触らない
}

/** 文字列そのものを、一時ファイル経由で置き換えて書く (取り消し・巻き戻しで、元の書き方を保つ)。上書き前の内容は世代に残す */
async function writeTextAtomic(abs: string, text: string): Promise<void> {
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(tmp, text, "utf-8");
    await backupBeforeOverwrite(abs, text);
    await fs.rename(tmp, abs);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

function entityNameOf(data: unknown, fallback: string): string {
  if (!isRecord(data)) return fallback;
  const meta = isRecord(data.meta) ? data.meta : null;
  const n = [data.name, meta?.name, data.title].find((x) => typeof x === "string" && x) as string | undefined;
  return n ?? fallback;
}

interface Scanned { target: TargetFile; data: unknown; text: string; found: Found[]; name: string }

async function scanAll(root: string, opts: ReplaceOptions): Promise<Scanned[]> {
  assertOptions(opts);
  const dataRoot = await resolveDataRoot(root);
  const re = buildMatcher(opts);
  const out: Scanned[] = [];
  for (const target of await listTargets(dataRoot)) {
    const file = await readJsonFile(target.abs);
    if (!file) continue;
    const found = scanEntity(target.kind, file.data, re);
    if (found.length > 0) out.push({ target, data: file.data, text: file.text, found, name: entityNameOf(file.data, target.id) });
  }
  return out;
}

export function candidateKey(kind: ReplaceKind, id: string, ptr: string): string { return `${kind}:${id}#${ptr}`; }

function replaceIn(value: string, opts: ReplaceOptions): string {
  return value.replace(buildMatcher(opts), () => opts.replacement);
}

// ── 予行 ────────────────────────────────────────────────────────────────

export async function previewReplace(root: string, opts: ReplaceOptions, isBlocked: BlockedCheck = () => null): Promise<ReplacePreview> {
  const release = await acquireWorkspaceLock(root);
  try {
    const scanned = await scanAll(root, opts);
    const candidates: ReplaceCandidate[] = [];
    const blocked: ReplacePreview["blocked"] = [];
    let total = 0;
    for (const s of scanned) {
      const reason = isBlocked(s.target.kind, s.target.id);
      if (reason) blocked.push({ kind: s.target.kind, id: s.target.id, reason });
      for (const f of s.found) {
        total++;
        if (candidates.length < PREVIEW_MAX) {
          candidates.push({
            key: candidateKey(s.target.kind, s.target.id, f.ptr), kind: s.target.kind, id: s.target.id, entityName: s.name,
            where: f.where, before: f.value, after: replaceIn(f.value, opts),
          });
        }
      }
    }
    return { candidates, total, truncated: total > candidates.length, entities: scanned.length, blocked };
  } finally { release(); }
}

// ── 適用と取り消し ──────────────────────────────────────────────────────

interface UndoFile { rel: string; abs: string; original: string; replaced: string }
interface UndoOperation { id: string; ts: number; files: UndoFile[]; replaced: number; query: string; replacement: string }
const undoStore = new Map<string, Map<string, UndoOperation>>();

function pushUndo(root: string, op: UndoOperation): void {
  let per = undoStore.get(root);
  if (!per) { per = new Map(); undoStore.set(root, per); }
  per.set(op.id, op);
  while (per.size > UNDO_MAX_PER_WORKSPACE) { const first = per.keys().next().value; if (first === undefined) break; per.delete(first); }
}

/** 取り消せる直近の置換 (30 分以内) */
export function listReplaceUndo(root: string): Array<{ operationId: string; replaced: number; files: number; query: string; replacement: string; remainingMs: number }> {
  const per = undoStore.get(root);
  if (!per) return [];
  const now = Date.now();
  const out: ReturnType<typeof listReplaceUndo> = [];
  for (const [id, op] of per) {
    const remainingMs = op.ts + UNDO_TTL_MS - now;
    if (remainingMs <= 0) { per.delete(id); continue; }
    out.push({ operationId: id, replaced: op.replaced, files: op.files.length, query: op.query, replacement: op.replacement, remainingMs });
  }
  return out.reverse();
}

export interface ReplaceResult {
  operationId: string | null;
  /** 置換した欄の数 */
  replaced: number;
  /** 書き換えたファイルの数 */
  files: number;
  /** 置換しなかったもの (理由つき) */
  skipped: Array<{ key: string; reason: string }>;
  /** 書き換えた設計 (画面の再読み込みの通知に使う) */
  touched: Array<{ kind: ReplaceKind; id: string }>;
}

/** 適用で選ぶもの。`before` は予行で見せた元の文言 (いま違えば、予行のあとに変えられたので飛ばす) */
export interface ReplaceSelection { key: string; before: string }

export async function applyReplace(
  root: string, opts: ReplaceOptions, selected: readonly ReplaceSelection[], isBlocked: BlockedCheck = () => null,
  /** 登録簿 (harmony.json) を編集中 (画面フローの編集セッション) の理由。あれば、一覧に映る名前の置換は飛ばす (あとの保存で、登録簿が巻き戻るため) */
  registryBlocked: string | null = null,
): Promise<ReplaceResult> {
  assertOptions(opts);
  if (!Array.isArray(selected) || selected.length === 0) throw new Error("置換するものを選んでください");
  if (selected.length > SELECT_MAX) throw new Error(`一度に置換できるのは ${SELECT_MAX} 件までです`);
  if (!selected.every((x) => x && typeof x.key === "string" && typeof x.before === "string")) throw new Error("選んだものの形が正しくありません");
  const want = new Map(selected.map((x) => [x.key, x.before]));
  const release = await acquireWorkspaceLock(root);
  try {
    const scanned = await scanAll(root, opts);
    const skipped: ReplaceResult["skipped"] = [];
    const plans: Array<{ s: Scanned; next: unknown; done: number }> = [];
    const seen = new Set<string>();
    for (const s of scanned) {
      const mine = s.found.filter((f) => want.has(candidateKey(s.target.kind, s.target.id, f.ptr)));
      if (mine.length === 0) continue;
      const reason = isBlocked(s.target.kind, s.target.id);
      if (reason) { for (const f of mine) skipped.push({ key: candidateKey(s.target.kind, s.target.id, f.ptr), reason }); continue; }
      const next = JSON.parse(s.text) as unknown; // 書き換えるのは、読み直した写し (走査した内容と同じ)
      let done = 0;
      for (const f of mine) {
        const key = candidateKey(s.target.kind, s.target.id, f.ptr);
        seen.add(key);
        if (registryBlocked && isRegistryName(s.target.kind, f.ptr)) { skipped.push({ key, reason: registryBlocked }); continue; }
        // 予行で見せた文言のままのものだけ置換する (予行のあとに変えられたものは、見せていない結果になるので飛ばす)
        if (want.get(key) !== f.value || getAt(next, f.ptr) !== f.value || !setAt(next, f.ptr, replaceIn(f.value, opts))) { skipped.push({ key, reason: "文言が変わっていたので、飛ばしました" }); continue; }
        done++;
      }
      if (done > 0) plans.push({ s, next, done });
    }
    for (const k of want.keys()) if (!seen.has(k) && !skipped.some((x) => x.key === k)) skipped.push({ key: k, reason: "もう一致しない (文言が変わった・設計が消えた) ので、飛ばしました" });
    if (plans.length === 0) return { operationId: null, replaced: 0, files: 0, skipped, touched: [] };

    // 書き込みの直前に、走査したときのまま変わっていないかを、すべて確かめる。変わっていたものは書かず、飛ばす
    // (編集セッションを使わない保存 (MCP など) は、この排他を取らないので、走査から書き込みのあいだに変えられうる)
    const live: typeof plans = [];
    for (const p of plans) {
      const now = await fs.readFile(p.s.target.abs, "utf-8").catch(() => null);
      if (now === p.s.text) { live.push(p); continue; }
      for (const f of p.s.found) {
        const key = candidateKey(p.s.target.kind, p.s.target.id, f.ptr);
        if (want.has(key) && !skipped.some((x) => x.key === key)) skipped.push({ key, reason: "置換の直前に、設計が書き換えられていたので、飛ばしました" });
      }
    }
    if (live.length === 0) return { operationId: null, replaced: 0, files: 0, skipped, touched: [] };

    // 一覧が読む登録簿 (harmony.json) の名前も、同じ操作で直す (設計のファイルだけ直すと、一覧・Ctrl+K・タブの題が古いままになる)
    const regUpdates: Array<{ key: string; id: string; name: string }> = [];
    for (const p of live) {
      const key = REGISTRY_KEY[p.s.target.kind];
      if (!key) continue;
      const ptr = p.s.target.kind === "process-flow" ? "meta/name" : "name";
      if (!p.s.found.some((f) => f.ptr === ptr && want.has(candidateKey(p.s.target.kind, p.s.target.id, f.ptr)))) continue;
      const nameNow = getAt(p.next, ptr);
      if (typeof nameNow === "string" && nameNow !== getAt(JSON.parse(p.s.text), ptr)) regUpdates.push({ key, id: p.s.target.id, name: nameNow });
    }
    const files: UndoFile[] = live.map((p) => ({ rel: p.s.target.rel, abs: p.s.target.abs, original: p.s.text, replaced: JSON.stringify(p.next, null, 2) }));
    const nextOf = new Map<string, unknown>(live.map((p) => [p.s.target.abs, p.next]));
    if (regUpdates.length > 0) {
      const regAbs = harmonyFile(root);
      const regText = await fs.readFile(regAbs, "utf-8").catch(() => null);
      let reg: unknown = null;
      try { reg = regText === null ? null : JSON.parse(regText); } catch { /* 壊れていれば、登録簿は触らない */ }
      if (regText !== null && isRecord(reg) && isRecord(reg.entities)) {
        let changed = false;
        for (const u of regUpdates) {
          const list = (reg.entities as Record<string, unknown>)[u.key];
          const entry = Array.isArray(list) ? list.find((e) => isRecord(e) && e.id === u.id) : undefined;
          if (isRecord(entry) && entry.name !== u.name) { entry.name = u.name; changed = true; }
        }
        if (changed) {
          files.push({ rel: "harmony.json", abs: regAbs, original: regText, replaced: JSON.stringify(reg, null, 2) });
          nextOf.set(regAbs, reg);
        }
      }
    }

    // 途中で止まっても元に戻せるよう、書き換える前の内容を先に記録する
    const done = await openJournal(root, planFromAbsolute(root, `replace "${opts.query}" -> "${opts.replacement}"`, files.map((f) => ({ absPath: f.abs, content: f.original })), []));
    const written: UndoFile[] = [];
    try {
      for (const f of files) {
        await writeJSON(f.abs, nextOf.get(f.abs)); // 一時ファイル → 置き換え + 保存前の版の世代
        written.push(f);
      }
    } catch (e) {
      // 途中で失敗: 書いたものを元に戻す。戻せないものがあれば、復旧用の記録 (.harmony-journal) を残す (次の起動で戻す)
      let restoreFailed = false;
      for (const f of written) await writeTextAtomic(f.abs, f.original).catch(() => { restoreFailed = true; });
      if (!restoreFailed) await done();
      throw new Error(`${e instanceof Error ? e.message : String(e)}${restoreFailed ? " (書き換えたファイルの一部を元に戻せませんでした。次の起動で、記録から元に戻します)" : ""}`);
    }
    await done();
    const replaced = live.reduce((n, p) => n + p.done, 0);
    const id = crypto.randomUUID();
    pushUndo(root, { id, ts: Date.now(), files, replaced, query: opts.query, replacement: opts.replacement });
    return { operationId: id, replaced, files: files.length, skipped, touched: live.map((p) => ({ kind: p.s.target.kind, id: p.s.target.id })) };
  } finally { release(); }
}

export interface UndoResult {
  restored: number;
  /** 置換のあとで変えられていて、戻さなかったファイル */
  conflicts: string[];
  touched: Array<{ rel: string }>;
}

export function findReplaceUndoRoot(operationId: string): string | null {
  for (const [root, per] of undoStore) if (per.has(operationId)) return root;
  return null;
}

export async function undoReplace(root: string, operationId: string): Promise<UndoResult> {
  const release = await acquireWorkspaceLock(root);
  try {
    const per = undoStore.get(root);
    const op = per?.get(operationId);
    if (!per || !op || Date.now() - op.ts > UNDO_TTL_MS) { per?.delete(operationId); throw new Error("取り消せる置換が見つかりません (30 分を過ぎたか、すでに取り消しました。保存前の版から戻せます)"); }
    const conflicts: string[] = [];
    let restored = 0;
    for (const f of op.files) {
      let current: string | null = null;
      try { current = await fs.readFile(f.abs, "utf-8"); } catch { /* 消えた */ }
      // 置換した内容のままのものだけ戻す。そのあとで変えられたものを、古い内容で上書きしない
      // (writeJSON は JSON.stringify(…, 2) で書くので、置換したときの文字列と一致する)
      if (current !== f.replaced) { conflicts.push(f.rel); continue; }
      await writeTextAtomic(f.abs, f.original); // 元の文字列そのものを書き戻す (整形の違いも含めて、置換の前と同じに戻る)
      restored++;
    }
    per.delete(operationId);
    return { restored, conflicts, touched: op.files.map((f) => ({ rel: f.rel })) };
  } finally { release(); }
}

/** テスト用 */
export function _clearReplaceUndoForTest(): void { undoStore.clear(); }
