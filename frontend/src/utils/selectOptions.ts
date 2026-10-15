import { applyCompletionHistory } from "./completionHistory";
import { bestRank } from "./textMatch";

export interface SelectOption {
  value: string;
  label: string;
  /** 小さく添える補足 (物理名・ID など)。検索の対象にもなる */
  hint?: string;
}

/** 絞り込んだ候補 (前方一致 → 部分一致の順。入力が空なら、履歴のあるものを上に) */
export function filterOptions(options: readonly SelectOption[], query: string, historyKey?: string): SelectOption[] {
  if (query.trim() === "") {
    if (!historyKey) return [...options];
    const byValue = new Map(options.map((o) => [o.value, o]));
    return applyCompletionHistory(`select:${historyKey}`, options.map((o) => ({ value: o.value })), () => 0)
      .map((c) => byValue.get(c.value)!);
  }
  return options
    .map((o, i) => ({ o, i, r: bestRank([o.label, o.hint, o.value], query) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.o);
}
