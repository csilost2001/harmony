import { useCallback, useMemo, useState } from "react";

export interface SortKey {
  columnKey: string;
  direction: "asc" | "desc";
}

export interface ListSort<T> {
  sortKeys: SortKey[];
  sorted: T[];
  /**
   * 列ヘッダクリック時に呼ぶ。
   * - 通常クリック: 単一ソート。昇→降→解除の 3 状態サイクル
   * - addKey=true (Shift+クリック): 多段ソートに追加 (昇→降→その列だけ解除)
   */
  toggleSort: (columnKey: string, opts?: { addKey?: boolean }) => void;
  clearSort: () => void;
  /** 多段ソート時の順位 (1-indexed)。対象外は null */
  getSortRank: (columnKey: string) => number | null;
  getSortDirection: (columnKey: string) => "asc" | "desc" | null;
}

/**
 * 一覧ソート。仕様 §3.6。見た目のみ、永続化なし。
 * - 昇→降→解除の 3 状態サイクル
 * - Shift+ クリックで多段ソート
 * - 物理順 (No 列) は変更しない — sorted 配列は参照のみ返す
 */
export function useListSort<T>(
  items: T[],
  getSortAccessor: (item: T, columnKey: string) => string | number,
): ListSort<T> {
  const [sortKeys, setSortKeys] = useState<SortKey[]>([]);

  const toggleSort = useCallback(
    (columnKey: string, opts?: { addKey?: boolean }) => {
      const addKey = opts?.addKey ?? false;
      setSortKeys((prev) => {
        const existingIdx = prev.findIndex((k) => k.columnKey === columnKey);
        if (!addKey) {
          if (existingIdx < 0) {
            return [{ columnKey, direction: "asc" }];
          }
          const current = prev[existingIdx];
          if (prev.length > 1) {
            // 多段 → 通常クリックは単一ソートに縮約
            return [{ columnKey, direction: "asc" }];
          }
          if (current.direction === "asc") return [{ columnKey, direction: "desc" }];
          return [];
        }
        // addKey: 多段ソートに追加
        if (existingIdx < 0) {
          return [...prev, { columnKey, direction: "asc" }];
        }
        const current = prev[existingIdx];
        const next = [...prev];
        if (current.direction === "asc") {
          next[existingIdx] = { columnKey, direction: "desc" };
          return next;
        }
        next.splice(existingIdx, 1);
        return next;
      });
    },
    [],
  );

  const clearSort = useCallback(() => setSortKeys([]), []);

  const getSortRank = useCallback(
    (columnKey: string) => {
      if (sortKeys.length <= 1) return null;
      const idx = sortKeys.findIndex((k) => k.columnKey === columnKey);
      return idx < 0 ? null : idx + 1;
    },
    [sortKeys],
  );

  const getSortDirection = useCallback(
    (columnKey: string) => {
      const key = sortKeys.find((k) => k.columnKey === columnKey);
      return key?.direction ?? null;
    },
    [sortKeys],
  );

  const sorted = useMemo(() => {
    if (sortKeys.length === 0) return items;
    const decorated = items.map((item, index) => ({ item, index }));
    decorated.sort((a, b) => {
      for (const key of sortKeys) {
        const va = getSortAccessor(a.item, key.columnKey);
        const vb = getSortAccessor(b.item, key.columnKey);
        let cmp: number;
        if (typeof va === "number" && typeof vb === "number") {
          cmp = va - vb;
        } else {
          cmp = String(va).localeCompare(String(vb), "ja");
        }
        if (cmp !== 0) return key.direction === "asc" ? cmp : -cmp;
      }
      // 安定ソート: タイは元順維持
      return a.index - b.index;
    });
    return decorated.map((d) => d.item);
  }, [items, sortKeys, getSortAccessor]);

  return {
    sortKeys,
    sorted,
    toggleSort,
    clearSort,
    getSortRank,
    getSortDirection,
  };
}
