/**
 * 画面デザイナのキーボード操作 (部品の木の中の移動と、入れ子の出入り)。画面に依存しない純関数。
 * - 選択の移動: ↑ / ↓ = 見た目の順 (木を上から下へ辿った順) の前後、← = 親、→ = 最初の子
 * - 入れ子の出入り: Alt+← = 親の外へ (親の直後へ)、Alt+→ = 直前の兄弟の中へ (最後の子として)
 */
import { canContain, findNode, findParent, type LayoutNode } from "@harmony/shared";

export interface Place { parentId: string | null; index: number }

/** 木を上から下へ辿った順の部品 ID */
export function flattenIds(nodes: readonly LayoutNode[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly LayoutNode[]) => { for (const n of list) { out.push(n.id); if (n.children) walk(n.children); } };
  walk(nodes);
  return out;
}

/** 見た目の順の前 / 後の部品 (端なら null) */
export function neighborId(nodes: readonly LayoutNode[], id: string, dir: -1 | 1): string | null {
  const ids = flattenIds(nodes);
  const at = ids.indexOf(id);
  if (at < 0) return null;
  return ids[at + dir] ?? null;
}

export function parentId(nodes: readonly LayoutNode[], id: string): string | null {
  return findParent(nodes, id)?.parent?.id ?? null;
}

export function firstChildId(nodes: readonly LayoutNode[], id: string): string | null {
  return findNode(nodes, id)?.children?.[0]?.id ?? null;
}

/** 親の外へ出す先 (親の直後)。最上位の部品、または出た先に置けない部品 (column / tab など) は null */
export function outdentPlace(nodes: readonly LayoutNode[], id: string): Place | null {
  const pos = findParent(nodes, id);
  const node = findNode(nodes, id);
  if (!pos?.parent || !node) return null;
  const grand = findParent(nodes, pos.parent.id);
  const grandType = grand?.parent?.type ?? null;
  if (!canContain(grandType, node.type)) return null;
  return { parentId: grand?.parent?.id ?? null, index: (grand?.index ?? 0) + 1 };
}

/** 直前の兄弟の中へ入れる先 (最後の子)。直前の兄弟が無い、または入れられない部品は null */
export function indentPlace(nodes: readonly LayoutNode[], id: string): Place | null {
  const pos = findParent(nodes, id);
  const node = findNode(nodes, id);
  if (!pos || !node) return null;
  const siblings = pos.parent ? pos.parent.children ?? [] : nodes;
  const prev = siblings[pos.index - 1];
  if (!prev || !canContain(prev.type, node.type)) return null;
  return { parentId: prev.id, index: prev.children?.length ?? 0 };
}
