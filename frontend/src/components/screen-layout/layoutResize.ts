/**
 * 画面デザイナの「段の幅をドラッグで調整」(UI 改善提案 第 3 弾 #44)。画面に依存しない純関数。
 * 段 (column) の幅は props.span (12 分割。既定 6)。隣り合う 2 つの段の境界を動かすと、合計を保ったまま、片方が増えて片方が減る。
 */
import { findParent, type LayoutNode } from "@harmony/shared";

export const DEFAULT_SPAN = 6;
export const MIN_SPAN = 1;
export const MAX_SPAN = 12;

export interface SpanPair { leftId: string; rightId: string; leftSpan: number; rightSpan: number }

const spanOf = (n: LayoutNode): number => n.props?.span ?? DEFAULT_SPAN;

/** 段の右隣の段 (最後の段は null) */
export function rightNeighborColumn(nodes: readonly LayoutNode[], columnId: string): LayoutNode | null {
  const pos = findParent(nodes, columnId);
  if (!pos?.parent || pos.parent.type !== "columns") return null;
  const next = (pos.parent.children ?? [])[pos.index + 1];
  return next && next.type === "column" ? next : null;
}

/** 動かし始めの 2 つの幅から、delta (12 分割の単位) 動かしたあとの幅。合計は保ち、どちらも 1 未満にしない */
export function pairAfterDelta(baseLeft: number, baseRight: number, delta: number): { leftSpan: number; rightSpan: number } {
  const total = baseLeft + baseRight;
  const leftSpan = Math.min(Math.max(baseLeft + delta, MIN_SPAN), Math.max(total - MIN_SPAN, MIN_SPAN));
  return { leftSpan, rightSpan: total - leftSpan };
}

/** 段の幅 (指定が無ければ既定) と、右隣の段 */
export function columnPairOf(nodes: readonly LayoutNode[], leftId: string): { left: LayoutNode; right: LayoutNode; baseLeft: number; baseRight: number } | null {
  const pos = findParent(nodes, leftId);
  const left = pos?.parent?.children?.[pos.index];
  const right = rightNeighborColumn(nodes, leftId);
  if (!left || left.type !== "column" || !right) return null;
  return { left, right, baseLeft: spanOf(left), baseRight: spanOf(right) };
}

/** 左の段の幅を delta だけ増減し、合計を保って右隣から差し引く。動かせなければ null */
export function resizeColumnPair(nodes: readonly LayoutNode[], leftId: string, delta: number): SpanPair | null {
  const pair = columnPairOf(nodes, leftId);
  if (!pair) return null;
  return { leftId, rightId: pair.right.id, ...pairAfterDelta(pair.baseLeft, pair.baseRight, delta) };
}

/** ポインタの移動量 (px) を、12 分割の単位にする。段の並びの全体の幅と、段の幅の合計から割り出す */
export function spanDeltaFromPixels(dx: number, rowWidth: number, totalSpan: number): number {
  if (rowWidth <= 0 || totalSpan <= 0) return 0;
  return Math.round(dx / (rowWidth / totalSpan));
}
