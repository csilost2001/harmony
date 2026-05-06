import { useState, useCallback, useRef } from "react";

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
  /** 初期値を再設定し履歴をクリア（データロード時に使用） */
  reset: (value: T) => void;
}

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
  onSaveRef.current = opts?.onSave;

  const [present, setPresent] = useState<T>(initial);

  // useRef で履歴を管理（再レンダリングを最小化）
  const historyRef = useRef<{ past: T[]; future: T[] }>({ past: [], future: [] });
  // canUndo/canRedo はレンダリングに影響するため useState
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const syncFlags = useCallback(() => {
    setCanUndo(historyRef.current.past.length > 0);
    setCanRedo(historyRef.current.future.length > 0);
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
    reset,
  };
}
