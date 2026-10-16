/**
 * 一覧の「条件で選ぶ」(UI 改善提案 第 3 弾 #57)。列の値で、行を選ぶ。画面に依存しない純関数。
 * 文字の比較は、全角・半角・大文字小文字・ひらがな / カタカナの違いを無視する (textMatch)。
 */
import { normalizeForMatch } from "./textMatch";

export type ConditionOp = "contains" | "equals" | "empty" | "notEmpty" | "sameAsSelected";

export const CONDITION_OPS: Array<{ op: ConditionOp; label: string; needsValue: boolean }> = [
  { op: "contains", label: "を含む", needsValue: true },
  { op: "equals", label: "と同じ", needsValue: true },
  { op: "empty", label: "が空", needsValue: false },
  { op: "notEmpty", label: "が空でない", needsValue: false },
  { op: "sameAsSelected", label: "が、いま選んでいる行と同じ", needsValue: false },
];

const text = (v: string | number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

/** 条件に合う行の id (一覧の並びのまま)。selected は sameAsSelected の基準 (いま選んでいる行の id) */
export function matchRowIds<T>(
  items: readonly T[], getId: (t: T) => string, accessor: (t: T) => string | number | null | undefined,
  op: ConditionOp, value: string, selected: ReadonlySet<string>,
): string[] {
  const norm = (s: string) => normalizeForMatch(s);
  const q = norm(value.trim());
  let sameSet: Set<string> | null = null;
  if (op === "sameAsSelected") sameSet = new Set(items.filter((i) => selected.has(getId(i))).map((i) => norm(text(accessor(i)))));
  return items.filter((i) => {
    const v = norm(text(accessor(i)).trim());
    switch (op) {
      case "contains": return q !== "" && v.includes(q);
      case "equals": return q !== "" && v === q;
      case "empty": return v === "";
      case "notEmpty": return v !== "";
      case "sameAsSelected": return !!sameSet && sameSet.size > 0 && sameSet.has(v);
    }
  }).map(getId);
}

export type SelectMode = "replace" | "add" | "remove";

/** 選択に、該当した行を反映する */
export function combineSelection(current: ReadonlySet<string>, matched: readonly string[], mode: SelectMode): Set<string> {
  if (mode === "replace") return new Set(matched);
  const next = new Set(current);
  for (const id of matched) { if (mode === "add") next.add(id); else next.delete(id); }
  return next;
}
