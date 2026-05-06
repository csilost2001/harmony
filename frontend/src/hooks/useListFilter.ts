import { useCallback, useMemo, useState } from "react";

export interface ListFilter<T> {
  filtered: T[];
  isActive: boolean;
  totalCount: number;
  visibleCount: number;
  applyFilter: (predicate: ((item: T) => boolean) | null) => void;
  clearFilter: () => void;
}

/**
 * 一覧フィルタ。述語関数 `(item) => boolean` を受け取り、filtered 配列を返す。
 * UI は画面ごとに自由。共通 API として filtered / カウント / clear を提供する。
 * 永続化はしない (仕様 §3.7 / §9)。
 */
export function useListFilter<T>(items: T[]): ListFilter<T> {
  const [predicate, setPredicate] = useState<((item: T) => boolean) | null>(null);

  const filtered = useMemo(() => {
    if (!predicate) return items;
    return items.filter(predicate);
  }, [items, predicate]);

  const applyFilter = useCallback((pred: ((item: T) => boolean) | null) => {
    setPredicate(() => pred);
  }, []);

  const clearFilter = useCallback(() => {
    setPredicate(null);
  }, []);

  return {
    filtered,
    isActive: predicate !== null,
    totalCount: items.length,
    visibleCount: filtered.length,
    applyFilter,
    clearFilter,
  };
}
