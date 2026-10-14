/**
 * 生成の記録 (`<データフォルダ>/generation.json`)。AI がコードを生成したときに、「どの設計 (の、どの版) から、どのファイルを作ったか」を残す。
 * これで、(1) 設計が変わって再生成が要るもの、(2) 生成物が手で書き換えられたもの、を検出できる (どちらが新しいか)。
 * 設計の版は、内容の印 (hash)。生成した時点の設計の写しは `.harmony-ops/gen-snapshots/` に置き、再生成の差分 (何が変わったか) の元にする。
 */
import { ID_RE, isIsoDateTime, isOpsEntityKind, isRecord, type OpsEntityKind, type Parsed } from "./common.js";

export interface GenSource { kind: OpsEntityKind; id: string; hash: string }
export interface GenOutput {
  /** ワークスペースからの相対パス (外へ出ない) */
  path: string;
  sources: GenSource[];
  /** 記録したときの、生成物の内容の印。無ければ、生成物の書き換えは検出しない */
  outputHash?: string;
  at: string;
  /** 生成の道具・skill (例: generate-code) */
  generator?: string;
  note?: string;
}
export interface GenerationFile { version: 1; outputs: GenOutput[] }
export const emptyGeneration = (): GenerationFile => ({ version: 1, outputs: [] });
export const MAX_GEN_OUTPUTS = 5000;
export const MAX_GEN_SOURCES = 200;
const HASH_RE = /^[0-9a-f]{64}$/;

/** 相対パスの検査 (外へ出ない・絶対パスでない・隠しフォルダでない) */
export function isSafeRelPath(p: unknown): p is string {
  if (typeof p !== "string" || !p || p.length > 300 || p.includes("\0") || p.includes("\\")) return false;
  if (p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false;
  return p.split("/").every((s) => s !== "" && s !== "." && s !== ".." && !s.startsWith(".harmony-"));
}

export function parseGeneration(raw: unknown): Parsed<GenerationFile> {
  const value = emptyGeneration();
  const problems: string[] = [];
  if (raw === undefined || raw === null) return { value, problems };
  if (!isRecord(raw) || !Array.isArray(raw.outputs)) return { value, problems: ["generation.json の形が正しくありません"] };
  const seen = new Set<string>();
  raw.outputs.slice(0, MAX_GEN_OUTPUTS).forEach((o, i) => {
    if (!isRecord(o) || !isSafeRelPath(o.path) || !isIsoDateTime(o.at) || !Array.isArray(o.sources)) { problems.push(`生成の記録の ${i + 1} 件目が読めません`); return; }
    if (seen.has(o.path)) { problems.push(`生成の記録「${o.path}」が重複しています`); return; }
    seen.add(o.path);
    const sources: GenSource[] = [];
    for (const s of o.sources.slice(0, MAX_GEN_SOURCES)) if (isRecord(s) && isOpsEntityKind(s.kind) && typeof s.id === "string" && ID_RE.test(s.id) && typeof s.hash === "string" && HASH_RE.test(s.hash)) sources.push({ kind: s.kind, id: s.id, hash: s.hash });
    value.outputs.push({
      path: o.path, sources, at: o.at,
      ...(typeof o.outputHash === "string" && HASH_RE.test(o.outputHash) ? { outputHash: o.outputHash } : {}),
      ...(typeof o.generator === "string" && o.generator ? { generator: o.generator.slice(0, 100) } : {}),
      ...(typeof o.note === "string" && o.note ? { note: o.note.slice(0, 500) } : {}),
    });
  });
  return { value, problems };
}

export type DriftState = "current" | "design-changed" | "output-changed" | "both-changed" | "output-missing";
export const DRIFT_LABELS: Record<DriftState, string> = {
  current: "最新", "design-changed": "設計が変わった (再生成が必要)", "output-changed": "生成物が書き換えられた", "both-changed": "設計も生成物も変わった (どちらを正とするか確認)", "output-missing": "生成物がない",
};

export interface DriftSourceChange { kind: OpsEntityKind; id: string; state: "changed" | "deleted" }
export interface DriftRow { path: string; state: DriftState; at: string; generator?: string; changedSources: DriftSourceChange[] }

/** 記録といまの状態を突き合わせる。`current` は、設計の現在の印 ("kind:id" → hash。無ければ削除済み)、`outputNow` は生成物の現在の印 (null = ファイルがない) */
export function computeDrift(file: GenerationFile, current: ReadonlyMap<string, string>, outputNow: (path: string) => string | null): DriftRow[] {
  return file.outputs.map((o) => {
    const changedSources: DriftSourceChange[] = [];
    for (const s of o.sources) {
      const now = current.get(`${s.kind}:${s.id}`);
      if (now === undefined) changedSources.push({ kind: s.kind, id: s.id, state: "deleted" });
      else if (now !== s.hash) changedSources.push({ kind: s.kind, id: s.id, state: "changed" });
    }
    const out = outputNow(o.path);
    const outputChanged = out !== null && !!o.outputHash && out !== o.outputHash;
    const designChanged = changedSources.length > 0;
    const state: DriftState = out === null ? "output-missing" : designChanged && outputChanged ? "both-changed" : designChanged ? "design-changed" : outputChanged ? "output-changed" : "current";
    return { path: o.path, state, at: o.at, ...(o.generator ? { generator: o.generator } : {}), changedSources };
  });
}

// ── 設計の差分 (JSON の変更箇所) ──────────────────────────────────────────────

export interface JsonChange { path: string; type: "added" | "removed" | "changed"; before?: string; after?: string }
export const MAX_DIFF_CHANGES = 400;

const show = (v: unknown): string => {
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return t === undefined ? "" : t.length > 160 ? `${t.slice(0, 159)}…` : t;
};
const VOLATILE = new Set(["updatedAt"]);

/** 2 つの JSON の、変更箇所の一覧 (配列は、`id` を持つ要素なら id で突き合わせ、無ければ位置で突き合わせる)。上限を超えたら打ち切り、truncated を返す */
export function jsonDiff(before: unknown, after: unknown): { changes: JsonChange[]; truncated: boolean } {
  const changes: JsonChange[] = [];
  let truncated = false;
  const push = (c: JsonChange) => { if (changes.length >= MAX_DIFF_CHANGES) { truncated = true; return; } changes.push(c); };
  const keyOf = (v: unknown, i: number): string => (isRecord(v) && typeof v.id === "string" ? `#${v.id}` : `[${i}]`);
  const walk = (a: unknown, b: unknown, p: string): void => {
    if (truncated) return;
    if (Array.isArray(a) && Array.isArray(b)) {
      const mapA = new Map(a.map((x, i) => [keyOf(x, i), x]));
      const mapB = new Map(b.map((x, i) => [keyOf(x, i), x]));
      for (const [k, x] of mapA) { if (!mapB.has(k)) push({ path: `${p}${k}`, type: "removed", before: show(x) }); else walk(x, mapB.get(k), `${p}${k}`); }
      for (const [k, x] of mapB) if (!mapA.has(k)) push({ path: `${p}${k}`, type: "added", after: show(x) });
      return;
    }
    if (isRecord(a) && isRecord(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of [...keys].sort()) {
        if (VOLATILE.has(k)) continue;
        const sub = p ? `${p}.${k}` : k;
        if (!(k in a)) push({ path: sub, type: "added", after: show(b[k]) });
        else if (!(k in b)) push({ path: sub, type: "removed", before: show(a[k]) });
        else walk(a[k], b[k], sub);
      }
      return;
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) push({ path: p || "(全体)", type: "changed", before: show(a), after: show(b) });
  };
  walk(before, after, "");
  return { changes, truncated };
}
