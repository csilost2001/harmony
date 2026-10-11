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
 * - 入れ子 (インデント) は扱わない (スキーマに入れ子の置き場が無い。docs/spec/process-flow-keyboard.md)。
 * - 既存の工程の種類は、テキストから変えられない (行の `[種類]` を書き換えても無視して知らせる)。
 * 保存形式は今の JSON のまま。このモジュールは変換だけで、副作用を持たない。
 */
import type { Step, StepType } from "../types/v3";
import { STEP_KIND_LABELS } from "@harmony/shared";
import { createDefaultStep } from "../store/processFlowStore";

export interface OutlineLine {
  lineNo: number;
  kind: StepType;
  description: string;
  /** 行末の ^id (既存の工程との対応)。無ければ新しい工程 */
  id: string | null;
}
export interface OutlineError { lineNo: number; message: string }
export interface ParsedOutline { lines: OutlineLine[]; errors: OutlineError[] }

const ID_SUFFIX = /\s\^([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/;
const KIND_PREFIX = /^\[([^\]]+)\]\s*(.*)$/;

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

export function stepsToOutline(steps: readonly Step[]): string {
  return steps
    .map((s) => {
      const d = escapeText(s.description ?? "");
      return `[${kindLabel(s.kind)}]${d ? ` ${d}` : ""} ^${s.id}`;
    })
    .join("\n");
}

export function parseOutline(text: string, kinds: readonly StepType[]): ParsedOutline {
  const lines: OutlineLine[] = [];
  const errors: OutlineError[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    if (raw.trim() === "") return;
    if (/^\s/.test(raw)) {
      errors.push({ lineNo, message: "行頭に空白があります。入れ子 (インデント) は、まだ使えません" });
      return;
    }
    let body = raw.trimEnd();
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
    lines.push({ lineNo, kind, description: unescapeText(m[2].trim()), id });
  });
  return { lines, errors };
}

export interface OutlineApplyResult {
  steps: Step[];
  added: number;
  changed: number;
  /** 順序が入れ替わった (内容の変更を除く) */
  reordered: boolean;
  removed: Step[];
  /** 既存の工程で、行の種類が違っていたため無視した行 */
  kindIgnored: OutlineLine[];
}

/**
 * アウトラインの行を、既存の工程の並びへ反映した結果を返す (steps は書き換えない)。
 * `usedIds` は新しい工程の id が衝突しないための既存 id の集合 (新しい id を足していく)。
 */
export function applyOutline(steps: readonly Step[], lines: readonly OutlineLine[], usedIds: Set<string>): OutlineApplyResult {
  const byId = new Map(steps.map((s) => [s.id as string, s]));
  const taken = new Set<string>();
  const next: Step[] = [];
  const kindIgnored: OutlineLine[] = [];
  let added = 0;
  let changed = 0;
  for (const line of lines) {
    const existing = line.id ? byId.get(line.id) : undefined;
    if (existing && !taken.has(existing.id as string)) {
      taken.add(existing.id as string);
      if (existing.kind !== line.kind) kindIgnored.push(line);
      if ((existing.description ?? "") !== line.description) {
        changed++;
        next.push({ ...existing, description: line.description } as Step);
      } else {
        next.push(existing);
      }
    } else {
      const fresh = createDefaultStep(line.kind, usedIds);
      next.push({ ...fresh, description: line.description } as Step);
      added++;
    }
  }
  const removed = steps.filter((s) => !taken.has(s.id as string));
  const keptOrder = steps.filter((s) => taken.has(s.id as string)).map((s) => s.id);
  const newOrder = next.filter((s) => taken.has(s.id as string)).map((s) => s.id);
  const reordered = keptOrder.some((id, i) => id !== newOrder[i]);
  return { steps: next, added, changed, reordered, removed, kindIgnored };
}
