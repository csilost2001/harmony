import { useCallback, useRef, useState } from "react";
import type { Node } from "@xyflow/react";
import { snapToOthers, type GeomNode } from "../utils/diagramGeom";

export interface Guides { vertical: number[]; horizontal: number[] }
const NONE: Guides = { vertical: [], horizontal: [] };

export const nodeSize = (n: Node): { w: number; h: number } => ({
  w: n.measured?.width ?? n.width ?? (typeof n.style?.width === "number" ? n.style.width : 160),
  h: n.measured?.height ?? n.height ?? (typeof n.style?.height === "number" ? n.style.height : 60),
});
export const toGeom = (n: Node): GeomNode => ({ id: n.id, x: n.position.x, y: n.position.y, ...nodeSize(n) });

/**
 * ノードをドラッグしている間、ほかのノードの端・中央にそろったらガイド線を出し、離したときに吸い付かせる
 * (UI 改善提案 続編 第 7 弾 #121)。同じ親 (グループ) の中のノードどうしだけを見る。Shift を押している間は吸い付かない。
 */
export function useSnapGuides(getNodes: () => Node[], enabled: boolean) {
  const [guides, setGuides] = useState<Guides>(NONE);
  const getRef = useRef(getNodes);
  getRef.current = getNodes; // eslint-disable-line react-hooks/refs -- 最新の関数を、ドラッグ中の呼び出しで使う
  const compute = useCallback((node: Node) => {
    const others = getRef.current().filter((o) => o.id !== node.id && !o.hidden && o.parentId === node.parentId && !o.selected).map(toGeom);
    return snapToOthers(toGeom(node), others);
  }, []);
  const onNodeDrag = useCallback((e: React.MouseEvent | MouseEvent | TouchEvent, node: Node) => {
    if (!enabled || (e as MouseEvent).shiftKey) { setGuides((g) => (g.vertical.length || g.horizontal.length ? NONE : g)); return; }
    const r = compute(node);
    setGuides({ vertical: r.vertical, horizontal: r.horizontal });
  }, [enabled, compute]);
  /** 離したとき: 吸い付いた位置を返す (Shift なし・しきい値以内のとき)。ガイドは消す */
  const finish = useCallback((node: Node, shift = false): { x: number; y: number } => {
    setGuides(NONE);
    if (!enabled || shift) return node.position;
    const r = compute(node);
    return { x: r.x, y: r.y };
  }, [enabled, compute]);
  return { guides, onNodeDrag, finish };
}
