/**
 * 業務部品デザイナのドラッグ & ドロップ。
 *
 * HTML5 DnD を使い、ドラッグ中のポインタ位置から「どの容器の何番目に入るか」を計算する。
 * キャンバス上の部品要素には data-node-id / data-node-type、容器の中身を並べる要素には
 * data-drop-parent (容器の部品 ID。最上位は "__root__") を付けておく。
 */
import { canContain, isDescendant, type LayoutNode, type LayoutNodeType } from "@harmony/shared";

export const ROOT_ID = "__root__";
export const DND_MIME = "application/x-harmony-layout";

/** ドラッグで運ぶもの */
export type DragPayload =
  | { kind: "new-node"; nodeType: LayoutNodeType }
  | { kind: "move-node"; nodeId: string; nodeType: LayoutNodeType }
  | { kind: "place-item"; itemId: string; nodeType: LayoutNodeType }
  | { kind: "table-column"; tableId: string; columnId: string; nodeType: "field" };

/** ドラッグ中の payload は dataTransfer から dragover で読めないため、モジュールで保持する */
let current: DragPayload | null = null;
export function setDragPayload(p: DragPayload | null): void { current = p; }
export function getDragPayload(): DragPayload | null { return current; }

export interface Rect { left: number; top: number; width: number; height: number }

/**
 * 子要素の矩形の並びと、ポインタ位置から挿入位置 (0..n) を返す。
 * 行優先 (左→右、上→下) の並びを前提にする。
 */
export function insertionIndex(rects: readonly Rect[], x: number, y: number): number {
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (y < r.top) return i;
    const inRow = y >= r.top && y <= r.top + r.height;
    if (inRow && x < r.left + r.width / 2) return i;
  }
  return rects.length;
}

export interface DropTarget {
  parentId: string | null;
  index: number;
  /** 挿入位置を示す線 (キャンバス基準ではなく viewport 座標) */
  line: { left: number; top: number; width: number; height: number };
}

/**
 * ポインタ直下の要素から、payload を受け入れられる最も内側の容器を探して挿入位置を返す。
 * 受け入れ先が無ければ null。
 */
export function computeDropTarget(
  under: Element | null,
  x: number,
  y: number,
  payload: DragPayload,
  nodes: readonly LayoutNode[],
): DropTarget | null {
  let el: Element | null = under;
  while (el) {
    const zone = el.closest<HTMLElement>("[data-drop-parent]");
    if (!zone) return null;
    const parentAttr = zone.dataset.dropParent!;
    const parentId = parentAttr === ROOT_ID ? null : parentAttr;
    const parentType = (zone.dataset.dropParentType as LayoutNodeType | undefined) ?? null;
    const movingSelfInside = payload.kind === "move-node" && parentId !== null &&
      (parentId === payload.nodeId || isDescendant(nodes, payload.nodeId, parentId));
    if (!movingSelfInside && canContain(parentId === null ? null : parentType, payload.nodeType)) {
      const kids = Array.from(zone.children).filter((c): c is HTMLElement => c instanceof HTMLElement && !!c.dataset.nodeId);
      const rects = kids.map((k) => k.getBoundingClientRect());
      const index = insertionIndex(rects, x, y);
      const zr = zone.getBoundingClientRect();
      let line: DropTarget["line"];
      if (rects.length === 0) {
        line = { left: zr.left + 6, top: zr.top + 4, width: Math.max(zr.width - 12, 20), height: 3 };
      } else if (index < rects.length) {
        const r = rects[index];
        const horizontal = r.width < zr.width * 0.8 && index > 0 && Math.abs(rects[index - 1].top - r.top) < 4;
        line = horizontal
          ? { left: r.left - 3, top: r.top, width: 3, height: r.height }
          : { left: r.left, top: r.top - 3, width: r.width, height: 3 };
      } else {
        const r = rects[rects.length - 1];
        const horizontal = r.width < zr.width * 0.8;
        line = horizontal
          ? { left: r.left + r.width + 1, top: r.top, width: 3, height: r.height }
          : { left: r.left, top: r.top + r.height + 1, width: r.width, height: 3 };
      }
      return { parentId, index, line };
    }
    // 受け入れられない容器なら一段外側へ
    el = zone.parentElement;
  }
  return null;
}
