import { useState, useCallback, useEffect, useRef } from "react";

interface UndoableOptions<T> {
  /** Undo/Redo後に呼ばれる保存関数（デバウンスなし・即時） */
  onSave?: (state: T) => void;
  /** 履歴の最大件数（デフォルト50） */
  maxHistory?: number;
}

interface UndoableReturn<T> {
  /** 現在の状態 */
  state: T;
  /** 状態更新（履歴に積まない。テキスト入力中の一時状態用） */
  update: (updater: (prev: T) => T) => void;
  /** 状態更新＋履歴にスナップショット（構造変化用） */
  updateAndCommit: (updater: (prev: T) => T) => void;
  /** 現在の状態を履歴にスナップショット（onBlur時等に呼ぶ） */
  commit: () => void;
  /** 1つ戻す */
  undo: () => void;
  /** 1つ進める */
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** 積まれている履歴 (古い順の過去と、やり直せる未来)。変更履歴パネル用 */
  history: UndoHistoryView<T>;
  /** 履歴の途中へ一度に移る。負 = その数だけ戻る、正 = その数だけやり直す (足りなければ端まで) */
  jumpTo: (delta: number) => void;
  /** 初期値を再設定し履歴をクリア（データロード時に使用） */
  reset: (value: T) => void;
}

export interface UndoHistoryView<T> {
  /** 過去の状態 (古い順。最後がひとつ前の状態) */
  past: readonly T[];
  /** やり直せる未来の状態 (近い順) */
  future: readonly T[];
}

const EMPTY_HISTORY: UndoHistoryView<never> = { past: [], future: [] };

/**
 * Undo/Redo 対応の useState 代替フック
 *
 * past/present/future パターンで履歴を管理する。
 * - update(): 履歴に積まずに状態を更新（テキスト入力中の一時状態）
 * - updateAndCommit(): 更新前の状態を履歴に積んでから状態を更新（構造変化）
 * - commit(): 現在の状態を履歴に積む（onBlur時など）
 */
export function useUndoableState<T>(
  initial: T,
  opts?: UndoableOptions<T>,
): UndoableReturn<T> {
  const maxHistory = opts?.maxHistory ?? 50;
  const onSaveRef = useRef(opts?.onSave);
  useEffect(() => {
    onSaveRef.current = opts?.onSave;
  }, [opts?.onSave]);

  const [present, setPresent] = useState<T>(initial);

  // useRef で履歴を管理（再レンダリングを最小化）
  const historyRef = useRef<{ past: T[]; future: T[] }>({ past: [], future: [] });
  // canUndo/canRedo はレンダリングに影響するため useState
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [history, setHistory] = useState<UndoHistoryView<T>>(EMPTY_HISTORY);

  const syncFlags = useCallback(() => {
    const h = historyRef.current;
    setCanUndo(h.past.length > 0);
    setCanRedo(h.future.length > 0);
    // past / future は更新のたびに新しい配列に置き換えているので、そのまま見せてよい
    setHistory({ past: h.past, future: h.future });
  }, []);

  // commitRef: 最後にcommitした値を追跡し、重複commitを防ぐ
  const lastCommittedRef = useRef<T>(initial);

  const update = useCallback((updater: (prev: T) => T) => {
    setPresent(updater);
  }, []);

  const updateAndCommit = useCallback((updater: (prev: T) => T) => {
    setPresent((prev) => {
      const h = historyRef.current;
      h.past = [...h.past, prev].slice(-maxHistory);
      h.future = [];
      const next = updater(prev);
      lastCommittedRef.current = next;
      syncFlags();
      return next;
    });
  }, [maxHistory, syncFlags]);

  const commit = useCallback(() => {
    setPresent((current) => {
      // 最後にcommitした値と同じなら何もしない（重複防止）
      if (current === lastCommittedRef.current) return current;
      const h = historyRef.current;
      h.past = [...h.past, lastCommittedRef.current].slice(-maxHistory);
      h.future = [];
      lastCommittedRef.current = current;
      syncFlags();
      return current;
    });
  }, [maxHistory, syncFlags]);

  const undo = useCallback(() => {
    setPresent((current) => {
      const h = historyRef.current;
      if (h.past.length === 0) return current;
      const prev = h.past[h.past.length - 1];
      h.past = h.past.slice(0, -1);
      h.future = [current, ...h.future];
      lastCommittedRef.current = prev;
      syncFlags();
      onSaveRef.current?.(prev);
      return prev;
    });
  }, [syncFlags]);

  const redo = useCallback(() => {
    setPresent((current) => {
      const h = historyRef.current;
      if (h.future.length === 0) return current;
      const next = h.future[0];
      h.past = [...h.past, current];
      h.future = h.future.slice(1);
      lastCommittedRef.current = next;
      syncFlags();
      onSaveRef.current?.(next);
      return next;
    });
  }, [syncFlags]);

  const jumpTo = useCallback((delta: number) => {
    if (delta === 0) return;
    setPresent((current) => {
      const h = historyRef.current;
      let next: T;
      if (delta < 0) {
        const k = Math.min(-delta, h.past.length);
        if (k === 0) return current;
        const at = h.past.length - k;
        next = h.past[at];
        h.future = [...h.past.slice(at + 1), current, ...h.future];
        h.past = h.past.slice(0, at);
      } else {
        const k = Math.min(delta, h.future.length);
        if (k === 0) return current;
        next = h.future[k - 1];
        h.past = [...h.past, current, ...h.future.slice(0, k - 1)];
        h.future = h.future.slice(k);
      }
      lastCommittedRef.current = next;
      syncFlags();
      onSaveRef.current?.(next);
      return next;
    });
  }, [syncFlags]);

  const reset = useCallback((value: T) => {
    setPresent(value);
    historyRef.current = { past: [], future: [] };
    lastCommittedRef.current = value;
    syncFlags();
  }, [syncFlags]);

  return {
    state: present,
    update,
    updateAndCommit,
    commit,
    undo,
    redo,
    canUndo,
    canRedo,
    history,
    jumpTo,
    reset,
  };
}
