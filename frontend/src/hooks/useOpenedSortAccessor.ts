import { useCallback, useEffect, useRef } from "react";
import { openedAtOf } from "../utils/openedHistory";

/**
 * 一覧の並べ替えの値の取り出し方に、「最近開いた順」(列の key = "opened") を足す (UI 改善提案 続編 第 6 弾 #111)。
 * 昇順 = 最近開いたものが先。開いたことが無いものは最後。
 * @param tabType その一覧の行を開くタブの種類 (例: table)。タブの id は `<tabType>:<行の id>`
 */
export function useOpenedSortAccessor<T>(
  accessor: (item: T, key: string) => string | number,
  tabType: string,
  idOf: (item: T) => string,
): (item: T, key: string) => string | number {
  const idRef = useRef(idOf);
  useEffect(() => { idRef.current = idOf; });
  return useCallback((item: T, key: string) => {
    if (key !== "opened") return accessor(item, key);
    const at = openedAtOf(`${tabType}:${idRef.current(item)}`);
    return at === 0 ? Number.MAX_SAFE_INTEGER : -at;
  }, [accessor, tabType]);
}
