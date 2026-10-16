import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { describeChange } from "../utils/changeSummary";
import { showToast } from "../utils/toast";

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

interface Core<T> {
  past: T[];
  present: T;
  future: T[];
  /** 最後に履歴へ積んだ (commit した) 時点の状態 */
  committed: T;
  /** undo / redo / jumpTo のたびに増える (onSave の呼び出しと、通知の合図) */
  moves: number;
  /** 直近の undo / redo / jumpTo: 動かす前と後 */
  lastMove: { verb: "元に戻しました" | "やり直しました"; from: T; to: T } | null;
}

const start = <T,>(value: T): Core<T> => ({ past: [], present: value, future: [], committed: value, moves: 0, lastMove: null });

/**
 * Undo/Redo 対応の useState 代替フック
 *
 * past/present/future パターンで履歴を管理する。
 * - update(): 履歴に積まずに状態を更新（テキスト入力中の一時状態）
 * - updateAndCommit(): 更新前の状態を履歴に積んでから状態を更新（構造変化）
 * - commit(): 最後に積んだ状態を履歴に積む（onBlur時など）
 *
 * 状態の更新関数は純粋にしてある (履歴も、同じ 1 つの状態の中に持つ)。React の StrictMode は更新関数を 2 回呼ぶため、
 * 外の変数 (ref) を書き換える作りだと、commit と undo が同じ操作の中で続くときに、戻せなくなる。
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

  const [core, setCore] = useState<Core<T>>(() => start(initial));

  const update = useCallback((updater: (prev: T) => T) => {
    setCore((c) => ({ ...c, present: updater(c.present) }));
  }, []);

  const updateAndCommit = useCallback((updater: (prev: T) => T) => {
    setCore((c) => {
      const next = updater(c.present);
      return { ...c, past: [...c.past, c.present].slice(-maxHistory), present: next, future: [], committed: next };
    });
  }, [maxHistory]);

  const commit = useCallback(() => {
    setCore((c) => {
      // 最後に積んだ状態と同じなら何もしない（重複防止）
      if (c.present === c.committed) return c;
      return { ...c, past: [...c.past, c.committed].slice(-maxHistory), future: [], committed: c.present };
    });
  }, [maxHistory]);

  const undo = useCallback(() => {
    setCore((c) => {
      if (c.past.length === 0) return c;
      const prev = c.past[c.past.length - 1];
      return { ...c, past: c.past.slice(0, -1), present: prev, future: [c.present, ...c.future], committed: prev, moves: c.moves + 1, lastMove: { verb: "元に戻しました", from: c.present, to: prev } };
    });
  }, []);

  const redo = useCallback(() => {
    setCore((c) => {
      if (c.future.length === 0) return c;
      const next = c.future[0];
      return { ...c, past: [...c.past, c.present], present: next, future: c.future.slice(1), committed: next, moves: c.moves + 1, lastMove: { verb: "やり直しました", from: c.present, to: next } };
    });
  }, []);

  const jumpTo = useCallback((delta: number) => {
    if (delta === 0) return;
    setCore((c) => {
      if (delta < 0) {
        const k = Math.min(-delta, c.past.length);
        if (k === 0) return c;
        const at = c.past.length - k;
        const next = c.past[at];
        return { ...c, past: c.past.slice(0, at), present: next, future: [...c.past.slice(at + 1), c.present, ...c.future], committed: next, moves: c.moves + 1, lastMove: { verb: "元に戻しました", from: c.present, to: next } };
      }
      const k = Math.min(delta, c.future.length);
      if (k === 0) return c;
      const next = c.future[k - 1];
      return { ...c, past: [...c.past, c.present, ...c.future.slice(0, k - 1)], present: next, future: c.future.slice(k), committed: next, moves: c.moves + 1, lastMove: { verb: "やり直しました", from: c.present, to: next } };
    });
  }, []);

  const reset = useCallback((value: T) => { setCore(start(value)); }, []);

  // 戻す・やり直す・移ったあとの、保存の呼び出しと通知 (描画の中では行わない)
  const seenMoves = useRef(0);
  useEffect(() => {
    if (core.moves === seenMoves.current) return;
    seenMoves.current = core.moves;
    onSaveRef.current?.(core.present);
    // 何を戻した / やり直したかを短く知らせる (UI 改善提案 第 5 弾 #86)
    if (core.lastMove) showToast(`${core.lastMove.verb}: ${describeChange(core.lastMove.from, core.lastMove.to)}`, "info");
  }, [core]);

  const history = useMemo<UndoHistoryView<T>>(() => (core.past.length === 0 && core.future.length === 0 ? EMPTY_HISTORY : { past: core.past, future: core.future }), [core.past, core.future]);

  return {
    state: core.present,
    update,
    updateAndCommit,
    commit,
    undo,
    redo,
    canUndo: core.past.length > 0,
    canRedo: core.future.length > 0,
    history,
    jumpTo,
    reset,
  };
}
