import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setDirty as setTabDirty } from "../store/tabStore";

export interface UseListEditorOpts<T> {
  /** 識別子 */
  getId: (item: T) => string;
  /** バックエンドから全件ロード */
  load: () => Promise<T[]>;
  /**
   * 変更を永続化する。順序変更後の配列と、削除対象 ID を受け取る。
   * 実装側で「削除 → 順序保存」の順で永続化することを想定。
   */
  commit: (opts: { itemsInOrder: T[]; deletedIds: string[] }) => Promise<void>;
  /** タブ dirty 連動用。指定するとタブのインジケータが連動する */
  tabId?: string;
  /**
   * reorder / insert / insertAt の後に呼ばれる再採番関数 (docs/spec/list-common.md §3.10)。
   * 指定すると物理順の変更と連動して no フィールド等を 1..N で振り直せる。
   * markDeleted では呼ばれない (ghost は元の no を保持)。
   */
  renumber?: (items: T[]) => T[];
}

export interface UseListEditorResult<T> {
  /** 画面表示用: 並び順は draft、削除マーク中の項目も含まれる */
  items: T[];
  /** 削除マーク中の ID */
  deletedIds: Set<string>;
  /** 指定 ID が削除マーク中か */
  isDeleted: (id: string) => boolean;
  isDirty: boolean;
  isSaving: boolean;
  /** 外部からバックエンド変更が来て、未保存がある場合に true */
  externalChangeWhileDirty: boolean;
  /** 明示リロード (外部からの変更検知時など) */
  reload: () => Promise<void>;
  /** 並び順変更 (draft) */
  reorder: (fromIndex: number, toIndex: number) => void;
  /** 指定位置への挿入 (Ctrl+V の貼付など) */
  insertAt: (newItems: T[], atIndex: number) => void;
  /** 削除マーク追加 */
  markDeleted: (ids: string[]) => void;
  /** 削除マーク解除 */
  unmarkDeleted: (ids: string[]) => void;
  /** 削除マークをトグル */
  toggleDeleted: (ids: string[]) => void;
  /** 追加 (即 draft に追加、isDirty=true) */
  insert: (items: T[], atIndex?: number) => void;
  /**
   * draft を直接操作 (アイテム内容変更など)。
   *
   * **注意**: このフックに渡した `renumber` コールバックは setItems では呼ばれない。
   * 物理順を変える用途 (並び替え・挿入・貼り付け等) で使う場合、呼び出し側で
   * `renumber(next)` を返すこと。docs/spec/list-common.md §3.10。
   */
  setItems: (updater: (prev: T[]) => T[]) => void;
  /** 保存 (削除 → 並び順コミット) */
  save: () => Promise<void>;
  /** ドラフトを破棄してバックエンドから再ロード */
  reset: () => Promise<void>;
  /** 外部変更バナーを閉じる */
  dismissExternalChange: () => void;
}

/**
 * 一覧画面向けのドラフト/保存/リセット/削除ゴースト管理フック。
 *
 * - 並び順の変更・削除マークはすべて draft 状態。明示 save で永続化。
 * - 削除はゴースト方式: 削除マークされたアイテムは items に残る (表示側で opacity を下げる)
 * - reset でドラフト破棄 → reload
 */
export function useListEditor<T>(opts: UseListEditorOpts<T>): UseListEditorResult<T> {
  const { getId, load, commit, tabId, renumber } = opts;
  const applyRenumber = useCallback((items: T[]) => (renumber ? renumber(items) : items), [renumber]);

  const [items, setItemsState] = useState<T[]>([]);
  const [loadedItems, setLoadedItems] = useState<T[]>([]);
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [externalChangeWhileDirty, setExternalChangeWhileDirty] = useState(false);
  const dirtyRef = useRef(false);

  const isDirty = useMemo(() => {
    if (deletedIds.size > 0) return true;
    if (items.length !== loadedItems.length) return true;
    for (let i = 0; i < items.length; i++) {
      if (getId(items[i]) !== getId(loadedItems[i])) return true;
    }
    return false;
  }, [items, loadedItems, deletedIds, getId]);

  useEffect(() => {
    dirtyRef.current = isDirty;
    if (tabId) setTabDirty(tabId, isDirty);
  }, [tabId, isDirty]);

  const reload = useCallback(async () => {
    const loaded = applyRenumber(await load());
    setLoadedItems(loaded);
    setItemsState(loaded);
    setDeletedIds(new Set());
    setExternalChangeWhileDirty(false);
  }, [load, applyRenumber]);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setItemsState((prev) => {
      if (fromIndex < 0 || toIndex < 0) return prev;
      if (fromIndex >= prev.length || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return applyRenumber(next);
    });
  }, [applyRenumber]);

  const insertAt = useCallback((newItems: T[], atIndex: number) => {
    setItemsState((prev) => {
      const idx = Math.max(0, Math.min(prev.length, atIndex));
      const next = [...prev];
      next.splice(idx, 0, ...newItems);
      return applyRenumber(next);
    });
  }, [applyRenumber]);

  const insert = useCallback((newItems: T[], atIndex?: number) => {
    setItemsState((prev) => {
      const idx = atIndex == null ? prev.length : Math.max(0, Math.min(prev.length, atIndex));
      const next = [...prev];
      next.splice(idx, 0, ...newItems);
      return applyRenumber(next);
    });
  }, [applyRenumber]);

  const markDeleted = useCallback((ids: string[]) => {
    setDeletedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const unmarkDeleted = useCallback((ids: string[]) => {
    setDeletedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const toggleDeleted = useCallback((ids: string[]) => {
    setDeletedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }, []);

  const isDeleted = useCallback((id: string) => deletedIds.has(id), [deletedIds]);

  const setItems = useCallback((updater: (prev: T[]) => T[]) => {
    setItemsState(updater);
  }, []);

  const save = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      const deleted = Array.from(deletedIds);
      const itemsInOrder = applyRenumber(items.filter((it) => !deletedIds.has(getId(it))));
      await commit({ itemsInOrder, deletedIds: deleted });
      await reload();
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, deletedIds, items, commit, reload, getId, applyRenumber]);

  const reset = useCallback(async () => {
    await reload();
  }, [reload]);

  const dismissExternalChange = useCallback(() => {
    setExternalChangeWhileDirty(false);
  }, []);

  return {
    items,
    deletedIds,
    isDeleted,
    isDirty,
    isSaving,
    externalChangeWhileDirty,
    reload,
    reorder,
    insertAt,
    markDeleted,
    unmarkDeleted,
    toggleDeleted,
    insert,
    setItems,
    save,
    reset,
    dismissExternalChange,
  };
}
