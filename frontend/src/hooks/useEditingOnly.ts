import { useMemo, useState } from "react";
import type { ListFacet } from "../components/common/ListViewBar";

/**
 * 一覧の「編集中だけ」の絞り込み (UI 改善提案 続編 第 6 弾 #111)。未保存の下書きがある (編集セッションが開いている) 設計だけを残す。
 * 返す `items` を useListFilter に渡し、`facet` を ListViewBar の facets に渡すと、チップ・保存した絞り込みにも載る。
 */
export function useEditingOnly<T>(items: T[], isEditing: (item: T) => boolean): { items: T[]; facet: ListFacet; on: boolean } {
  const [on, setOn] = useState(false);
  const shown = useMemo(() => (on ? items.filter(isEditing) : items), [on, items, isEditing]);
  const facet: ListFacet = { key: "editing", label: "編集中", value: on ? "1" : "", text: "下書きあり", set: (v) => setOn(v === "1") };
  return { items: shown, facet, on };
}
