/**
 * 長い一覧の窓表示 (UI 改善提案 続編 第 10 弾 #192)。行が多い (150 行以上) 一覧は、見える範囲 (と、その前後の余り) の行だけを描き、
 * 描かない行の高さは、上下の余白の行で補う。画面に依存しない計算と、「いまは窓表示を止める」合図 (画面内の検索が全行を探せるように)。
 */
import { useSyncExternalStore } from "react";

export const WINDOW_THRESHOLD = 150;
export const WINDOW_OVERSCAN = 20;
export const DEFAULT_ROW_HEIGHT = 36;

export interface WindowRange { start: number; end: number }

/**
 * 見える範囲の行 [start, end)。`scrollTop`: スクロールの位置、`viewport`: 見える高さ、`listTop`: スクロールする入れ物の先頭から、行の先頭までの距離。
 * 行数より多くならず、少なくとも 1 行は含む。
 */
export function visibleRange(p: { scrollTop: number; viewport: number; listTop: number; rowHeight: number; count: number; overscan?: number }): WindowRange {
  const over = p.overscan ?? WINDOW_OVERSCAN;
  const h = Math.max(1, p.rowHeight);
  const first = Math.floor((p.scrollTop - p.listTop) / h);
  const last = Math.ceil((p.scrollTop + p.viewport - p.listTop) / h);
  const start = Math.min(Math.max(0, first - over), Math.max(0, p.count - 1));
  const end = Math.min(p.count, Math.max(start + 1, last + over));
  return { start, end };
}

/** 窓表示を使うか: 行が多く、グループ表示でなく、止められていない */
export const shouldWindow = (count: number, grouped: boolean, suspended: boolean): boolean => count >= WINDOW_THRESHOLD && !grouped && !suspended;

// ── 窓表示を止める合図 (画面内の検索 Ctrl+F が、すべての行を探せるように) ──────────
const suspendedBy = new Set<string>();
const listeners = new Set<() => void>();
let snapshot = false;
const emit = () => { snapshot = suspendedBy.size > 0; listeners.forEach((l) => l()); };

/** 止める / 止めるのをやめる。呼び出し元の名前ごとに数える (複数が止めても、全員がやめるまで止まる) */
export function suspendWindowing(owner: string, on: boolean): void {
  const had = suspendedBy.has(owner);
  if (on && !had) { suspendedBy.add(owner); emit(); }
  else if (!on && had) { suspendedBy.delete(owner); emit(); }
}
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
export const useWindowingSuspended = (): boolean => useSyncExternalStore(subscribe, () => snapshot, () => false);
/** テスト用 */
export function _resetWindowing(): void { suspendedBy.clear(); emit(); }
