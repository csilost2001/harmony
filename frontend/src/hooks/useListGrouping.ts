import { useCallback, useMemo } from "react";
import { usePersistentState } from "./usePersistentState";
import type { ListGroupOption } from "../utils/listGroup";

export interface ListGrouping<T> {
  options: ListGroupOption<T>[];
  /** いま選んでいるグループ (無ければ null = まとめない) */
  active: ListGroupOption<T> | null;
  setGroup: (id: string | null) => void;
}

/**
 * 一覧のグループ表示の選び方 (UI 改善提案 続編 第 6 弾 #102)。選んだものは、一覧ごとにブラウザへ覚える。
 * `active?.keyOf` を useListSort の groupBy に渡し、`grouping` 自体を DataList に渡す。
 */
export function useListGrouping<T>(options: ListGroupOption<T>[], prefsKey: string): ListGrouping<T> {
  const [id, setId] = usePersistentState<string>(`harmony-list-group:${prefsKey}`, "");
  const active = useMemo(() => options.find((o) => o.id === id) ?? null, [options, id]);
  const setGroup = useCallback((next: string | null) => setId(next ?? ""), [setId]);
  return { options, active, setGroup };
}
