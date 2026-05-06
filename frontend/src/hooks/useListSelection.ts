import { useState, useCallback, useRef, useMemo, useEffect } from "react";

export interface ListSelection<T> {
  selectedIds: Set<string>;
  selectedItems: T[];
  isSelected: (id: string) => boolean;
  setSelectedIds: (ids: Set<string>) => void;
  clearSelection: () => void;
  selectAll: () => void;
  handleRowClick: (id: string, e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => void;
  /** キーボード操作のアンカー (Shift+↑↓ の基準点)。外部読み取り用 */
  getAnchorId: () => string | null;
}

/**
 * リスト行の複数選択ロジック。
 * - 通常クリック: 単一選択
 * - Ctrl+クリック: 選択のトグル (複数選択)
 * - Shift+クリック: アンカーからの範囲選択
 */
export function useListSelection<T>(
  items: T[],
  getId: (item: T) => string,
): ListSelection<T> {
  const [selectedIds, setSelectedIdsState] = useState<Set<string>>(new Set());
  const anchorIdRef = useRef<string | null>(null);

  const itemIds = useMemo(() => items.map(getId), [items, getId]);

  // 仕様 §3.8: items (フィルタ後の表示範囲) から消えた項目は selectedIds からも除外。
  // これにより、フィルタクリア時に「再表示された項目の選択が復活しない」挙動が成立する。
  useEffect(() => {
    const visible = new Set(itemIds);
    setSelectedIdsState((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visible.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
    if (anchorIdRef.current && !visible.has(anchorIdRef.current)) {
      anchorIdRef.current = null;
    }
  }, [itemIds]);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  const setSelectedIds = useCallback((ids: Set<string>) => {
    setSelectedIdsState(new Set(ids));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIdsState(new Set());
    anchorIdRef.current = null;
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIdsState(new Set(itemIds));
    if (itemIds.length > 0) anchorIdRef.current = itemIds[0];
  }, [itemIds]);

  const handleRowClick = useCallback(
    (id: string, e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl) {
        setSelectedIdsState((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
        anchorIdRef.current = id;
        return;
      }
      if (e.shiftKey && anchorIdRef.current) {
        const anchor = anchorIdRef.current;
        const fromIdx = itemIds.indexOf(anchor);
        const toIdx = itemIds.indexOf(id);
        if (fromIdx >= 0 && toIdx >= 0) {
          const [lo, hi] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
          setSelectedIdsState(new Set(itemIds.slice(lo, hi + 1)));
        }
        return;
      }
      setSelectedIdsState(new Set([id]));
      anchorIdRef.current = id;
    },
    [itemIds],
  );

  const selectedItems = useMemo(
    () => items.filter((it) => selectedIds.has(getId(it))),
    [items, selectedIds, getId],
  );

  const getAnchorId = useCallback(() => anchorIdRef.current, []);

  return {
    selectedIds,
    selectedItems,
    isSelected,
    setSelectedIds,
    clearSelection,
    selectAll,
    handleRowClick,
    getAnchorId,
  };
}
