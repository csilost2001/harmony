/**
 * 処理フローの工程を、1 行 1 工程のテキスト (アウトライン) と相互に変換する。
 *
 *   [入力チェック] 入力値を検証する ^step-01
 *   [DBアクセス] カートを取得する ^step-02
 *   [共通処理] 在庫を引き当てる          ← ^id が無い行は新しい工程
 *
 * - 工程の種類 (kind) と説明 (description) だけを文字で扱う。ほかの項目 (テーブル・条件・分岐の中身など) は、
 *   行末の `^id` で対応づけた既存の工程にそのまま残す。行を入れ替えれば工程の順序が変わり、行を消せば工程が消える。
 * - 説明の中の改行は `\n`、バックスラッシュは `\\`、`^` は `\^` と書く (行末の `^id` と区別するため)。
 * - 入れ子 (`subSteps`) は、空白 2 つの字下げで書く。字下げした行は、すぐ上の字下げの浅い行の配下の工程になる
 *   (docs/spec/process-flow-substeps.md)。分岐の枝・繰り返しの本体など、ほかの入れ子はここでは扱わない。
 * - 既存の工程の種類は、テキストから変えられない (行の `[種類]` を書き換えても無視して知らせる)。
 * 保存形式は今の JSON のまま。このモジュールは変換だけで、副作用を持たない。
 */
import type { Step, StepType } from "../types/v3";
import { STEP_KIND_LABELS } from "@harmony/shared";
import { createDefaultStep } from "../store/processFlowStore";

export interface OutlineLine {
  lineNo: number;
  /** 字下げの深さ (0 = 最上位。空白 2 つで 1) */
  depth: number;
  kind: StepType;
  description: string;
  /** 行末の ^id (既存の工程との対応)。無ければ新しい工程 */
  id: string | null;
  /** `[種類:参照先]` の参照先。書かれていなければ null (既存の工程では「変えない」)、`[種類:]` なら空文字 (消す) */
  ref: string | null;
}
export interface OutlineError { lineNo: number; message: string }
export interface ParsedOutline { lines: OutlineLine[]; errors: OutlineError[] }

/**
 * 種類ごとの「参照先」の項目 (行の `[種類:参照先]` で書く)。DB アクセス = テーブル、共通処理 = 処理フロー、
 * 画面遷移 = 遷移先の画面、外部システム = システム名 (context.catalogs.externalSystems のキー)。
 */
export const REF_FIELD: Partial<Record<StepType, { field: string; label: string }>> = {
  dbAccess: { field: "tableId", label: "テーブル" },
  commonProcess: { field: "refId", label: "処理フロー" },
  screenTransition: { field: "targetScreenId", label: "遷移先の画面" },
  externalSystem: { field: "systemRef", label: "外部システム" },
};

const ID_SUFFIX = /\s\^([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/;
const KIND_PREFIX = /^\[([^\]:]+)(?::([^\]]*))?\]\s*(.*)$/;

const escapeText = (s: string) => s.replace(/\\/g, "\\\\").replace(/\^/g, "\\^").replace(/\r?\n/g, "\\n");
const unescapeText = (s: string) => s.replace(/\\(\\|n|\^)/g, (_m, c: string) => (c === "n" ? "\n" : c));

export function kindLabel(kind: string): string {
  return STEP_KIND_LABELS[kind] ?? kind;
}

/** 種類の表示名 (または kind の英名) から kind を引く。未知なら null */
export function resolveKind(label: string, kinds: readonly StepType[]): StepType | null {
  const t = label.trim();
  for (const k of kinds) if (kindLabel(k) === t) return k;
  const lower = t.toLowerCase();
  for (const k of kinds) if (k.toLowerCase() === lower) return k;
  return null;
}

export function stepsToOutline(steps: readonly Step[], depth = 0): string {
  const rows: string[] = [];
  for (const step of steps) {
    const d = escapeText(step.description ?? "");
    const refField = REF_FIELD[step.kind as StepType]?.field;
    const ref = refField ? String((step as unknown as Record<string, unknown>)[refField] ?? "") : "";
    rows.push(`${"  ".repeat(depth)}[${kindLabel(step.kind)}${ref ? `:${ref}` : ""}]${d ? ` ${d}` : ""} ^${step.id}`);
    if (step.subSteps?.length) rows.push(stepsToOutline(step.subSteps, depth + 1));
  }
  return rows.join("\n");
}

export function parseOutline(text: string, kinds: readonly StepType[]): ParsedOutline {
  const lines: OutlineLine[] = [];
  const errors: OutlineError[] = [];
  let prevDepth = -1;
  text.split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    if (raw.trim() === "") return;
    const indent = /^[ \t]*/.exec(raw)![0];
    if (indent.includes("\t") || indent.length % 2 !== 0) {
      errors.push({ lineNo, message: "字下げは、空白 2 つ単位で書きます (タブは使えません)" });
      return;
    }
    const depth = indent.length / 2;
    if (depth > prevDepth + 1) {
      errors.push({ lineNo, message: "字下げが深すぎます (すぐ上の行より、1 段までです)" });
      return;
    }
    let body = raw.trim();
    let id: string | null = null;
    const idMatch = ID_SUFFIX.exec(body);
    if (idMatch) { id = idMatch[1]; body = body.slice(0, idMatch.index); }
    const m = KIND_PREFIX.exec(body);
    if (!m) {
      errors.push({ lineNo, message: "行頭に [種類] がありません (例: [DBアクセス] カートを取得する)" });
      return;
    }
    const kind = resolveKind(m[1], kinds);
    if (!kind) {
      errors.push({ lineNo, message: `[${m[1]}] という種類はありません` });
      return;
    }
    if (m[2] !== undefined && !REF_FIELD[kind]) {
      errors.push({ lineNo, message: `[${m[1]}] には、参照先 (:…) を書けません` });
      return;
    }
    lines.push({ lineNo, depth, kind, description: unescapeText(m[3].trim()), id, ref: m[2] !== undefined ? m[2].trim() : null });
    prevDepth = depth;
  });
  return { lines, errors };
}

export interface OutlineApplyResult {
  steps: Step[];
  added: number;
  changed: number;
  /** 順序や入れ子の位置が変わった (内容の変更を除く) */
  reordered: boolean;
  removed: Step[];
  /** 既存の工程で、行の種類が違っていたため無視した行 */
  kindIgnored: OutlineLine[];
}

interface Node { line: OutlineLine; base: Step; isNew: boolean; children: Node[] }

/** 工程の木 (最上位 + subSteps の再帰) を、先行順に (工程, 親の id) で並べる */
function flattenTree(steps: readonly Step[], parentId: string | null = null, out: Array<[string, string | null]> = []): Array<[string, string | null]> {
  for (const st of steps) {
    out.push([st.id as string, parentId]);
    if (st.subSteps?.length) flattenTree(st.subSteps, st.id as string, out);
  }
  return out;
}

/**
 * アウトラインの行を、既存の工程の並びへ反映した結果を返す (steps は書き換えない)。
 * 行の字下げが入れ子 (subSteps)。`usedIds` は新しい工程の id が衝突しないための既存 id の集合 (新しい id を足していく)。
 * 変わっていない工程は、元のオブジェクトをそのまま返す。
 */
export function applyOutline(steps: readonly Step[], lines: readonly OutlineLine[], usedIds: Set<string>): OutlineApplyResult {
  const byId = new Map<string, Step>();
  const collect = (list: readonly Step[]) => { for (const st of list) { byId.set(st.id as string, st); if (st.subSteps) collect(st.subSteps); } };
  collect(steps);

  const taken = new Set<string>();
  const kindIgnored: OutlineLine[] = [];
  let added = 0;
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const line of lines) {
    const existing = line.id ? byId.get(line.id) : undefined;
    let node: Node;
    if (existing && !taken.has(existing.id as string)) {
      taken.add(existing.id as string);
      if (existing.kind !== line.kind) kindIgnored.push(line);
      node = { line, base: existing, isNew: false, children: [] };
    } else {
      node = { line, base: createDefaultStep(line.kind, usedIds), isNew: true, children: [] };
      added++;
    }
    stack.length = line.depth;
    (stack[line.depth - 1]?.children ?? roots).push(node);
    stack[line.depth] = node;
  }

  let changed = 0;
  const build = (node: Node): Step => {
    const kids = node.children.map(build);
    const oldKids = node.base.subSteps ?? [];
    const sameKids = !node.isNew && kids.length === oldKids.length && kids.every((k, i) => k === oldKids[i]);
    const sameDesc = (node.base.description ?? "") === node.line.description;
    // 参照先: 書かれていれば反映 (`[種類:]` は消す)。書かれていなければ、既存の工程は変えない
    const refField = REF_FIELD[node.base.kind as StepType]?.field;
    const curRef = refField ? String((node.base as unknown as Record<string, unknown>)[refField] ?? "") : "";
    const newRef = node.line.ref;
    const refChanged = !!refField && newRef !== null && newRef !== curRef && node.base.kind === node.line.kind;
    if (!node.isNew && sameKids && sameDesc && !refChanged) return node.base;
    if (!node.isNew && (!sameDesc || refChanged)) changed++;
    const copy = { ...node.base, description: node.line.description } as Step;
    if (refChanged && refField) (copy as unknown as Record<string, unknown>)[refField] = newRef;
    if (kids.length > 0) copy.subSteps = kids; else delete copy.subSteps;
    return copy;
  };
  const next = roots.map(build);

  const removed = [...byId.values()].filter((st) => !taken.has(st.id as string));
  const before = flattenTree(steps).filter(([id]) => taken.has(id));
  const after = flattenTree(next).filter(([id]) => taken.has(id));
  const reordered = before.some(([id, parent], i) => id !== after[i]?.[0] || parent !== after[i]?.[1]);
  return { steps: next, added, changed, reordered, removed, kindIgnored };
}
