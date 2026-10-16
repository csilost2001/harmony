/**
 * 画面デザイナの複数選択と一括操作 (UI 改善提案 第 3 弾 #43)。画面に依存しない純関数。
 * - 選択の整理: 無い部品を外し、親も選ばれている部品は親にまとめ、見た目の順に並べる
 * - 範囲選択: 同じ親の中なら、間の兄弟をすべて。違う親なら、その 2 つだけ
 * - 一括の削除・複製・包む・上へ / 下へ
 */
import {
  canContain, findNode, findParent, insertNode, isDescendant, moveNode, nextNodeId, removeNode,
  type LayoutComponentDef, type LayoutNode, type LayoutNodeType,
} from "@harmony/shared";
import { flattenIds } from "./layoutKeyboard";
import { docDuplicate, docRemove, type LayoutDoc } from "./layoutModel";
import type { ScreenItem } from "../../types/v3/screen-item";

/** 選択を整える (存在しない部品・祖先も選ばれている部品を外し、見た目の順に並べる) */
export function normalizeSelection(nodes: readonly LayoutNode[], ids: readonly string[]): string[] {
  const order = flattenIds(nodes);
  const alive = [...new Set(ids)].filter((id) => order.includes(id));
  const top = alive.filter((id) => !alive.some((other) => other !== id && isDescendant(nodes, other, id)));
  return top.sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/** Shift+クリックの範囲。同じ親の兄弟どうしなら間をすべて、そうでなければ 2 つだけ */
export function rangeSelect(nodes: readonly LayoutNode[], anchorId: string, targetId: string): string[] {
  const a = findParent(nodes, anchorId);
  const b = findParent(nodes, targetId);
  if (!a || !b || (a.parent?.id ?? null) !== (b.parent?.id ?? null)) return [anchorId, targetId];
  const siblings = a.parent ? a.parent.children ?? [] : nodes;
  const [from, to] = a.index <= b.index ? [a.index, b.index] : [b.index, a.index];
  return siblings.slice(from, to + 1).map((n) => n.id);
}

/** 選択を切り替える (Ctrl+クリック) */
export function toggleSelection(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

/** 選択がすべて同じ親の直下にあるか (包む・上へ / 下へが使える条件) */
export function sharedParentId(nodes: readonly LayoutNode[], ids: readonly string[]): { ok: boolean; parentId: string | null } {
  let parent: string | null | undefined;
  for (const id of ids) {
    const pos = findParent(nodes, id);
    if (!pos) return { ok: false, parentId: null };
    const p = pos.parent?.id ?? null;
    if (parent === undefined) parent = p; else if (parent !== p) return { ok: false, parentId: null };
  }
  return { ok: parent !== undefined, parentId: parent ?? null };
}

/** まとめて削除する。削除した部品だけが使っていた画面項目も消す (1 件の削除と同じ規則) */
export function docRemoveMany(doc: LayoutDoc, ids: readonly string[], defs: readonly LayoutComponentDef[] = []): { doc: LayoutDoc; removedItemIds: string[] } {
  let cur = doc;
  const removedItemIds: string[] = [];
  for (const id of normalizeSelection(doc.layout?.nodes ?? [], ids)) {
    const r = docRemove(cur, id, true, defs);
    cur = r.doc;
    removedItemIds.push(...r.removedItemIds);
  }
  return { doc: cur, removedItemIds };
}

/** まとめて複製する (それぞれの直後に置く)。複製した部品の ID を返す */
export function docDuplicateMany(doc: LayoutDoc, ids: readonly string[]): { doc: LayoutDoc; newIds: string[] } {
  let cur = doc;
  const newIds: string[] = [];
  for (const id of normalizeSelection(doc.layout?.nodes ?? [], ids)) {
    const r = docDuplicate(cur, id);
    cur = r.doc;
    if (r.newId) newIds.push(r.newId);
  }
  return { doc: cur, newIds };
}

/** 包める入れ物 (選んだ部品を、新しい入れ物の中へ入れる) */
export const WRAP_TYPES: Array<{ type: LayoutNodeType; label: string; base: string; props?: LayoutNode["props"] }> = [
  { type: "section", label: "区画", base: "section", props: { title: "区画", variant: "card" } },
  { type: "form", label: "入力フォーム", base: "form", props: { columns: 2 } },
  { type: "button-bar", label: "ボタン群", base: "buttons", props: { align: "right" } },
];

/** 選んだ部品を、新しい入れ物で包めるか (同じ親・入れ物が全部を入れられる・入れ物が親に置ける) */
export function canWrap(nodes: readonly LayoutNode[], ids: readonly string[], wrapper: LayoutNodeType): boolean {
  const sel = normalizeSelection(nodes, ids);
  if (sel.length === 0) return false;
  const { ok, parentId } = sharedParentId(nodes, sel);
  if (!ok) return false;
  const parent = parentId ? findNode(nodes, parentId) : null;
  if (!canContain(parent?.type ?? null, wrapper)) return false;
  return sel.every((id) => {
    const n = findNode(nodes, id);
    return !!n && canContain(wrapper, n.type);
  });
}

/** 選んだ部品を、新しい入れ物で包む (入れ物は、選んだ先頭の位置に置く)。作った入れ物の ID を返す */
export function docWrap(doc: LayoutDoc, ids: readonly string[], wrapper: LayoutNodeType): { doc: LayoutDoc; wrapperId: string | null } {
  const nodes = doc.layout?.nodes ?? [];
  if (!doc.layout || !canWrap(nodes, ids, wrapper)) return { doc, wrapperId: null };
  const spec = WRAP_TYPES.find((w) => w.type === wrapper);
  if (!spec) return { doc, wrapperId: null };
  const sel = normalizeSelection(nodes, ids);
  const { parentId } = sharedParentId(nodes, sel);
  const first = findParent(nodes, sel[0])!;
  const moving = sel.map((id) => findNode(nodes, id)!);
  let next = [...nodes];
  for (const id of sel) next = removeNode(next, id).nodes;
  const wrapperNode: LayoutNode = { id: nextNodeId(next, spec.base), type: wrapper, props: { ...spec.props }, children: moving };
  next = insertNode(next, parentId, wrapperNode, first.index);
  return { doc: { ...doc, layout: { ...doc.layout, nodes: next } }, wrapperId: wrapperNode.id };
}

/** 兄弟の中で 1 つ上 / 下へ (まとめて)。端に着いている部品が 1 つでもあれば、何も動かさない */
export function moveManyInSiblings(nodes: readonly LayoutNode[], ids: readonly string[], dir: -1 | 1): LayoutNode[] {
  const sel = normalizeSelection(nodes, ids);
  const { ok, parentId } = sharedParentId(nodes, sel);
  if (!ok || sel.length === 0) return [...nodes];
  const parent = parentId ? findNode(nodes, parentId) : null;
  const siblings = parent ? parent.children ?? [] : nodes;
  const idx = sel.map((id) => siblings.findIndex((s) => s.id === id)).sort((a, b) => a - b);
  if (dir === -1 ? idx[0] === 0 : idx[idx.length - 1] === siblings.length - 1) return [...nodes];
  let cur = [...nodes];
  const ordered = dir === -1 ? sel : [...sel].reverse();
  for (const id of ordered) {
    const pos = findParent(cur, id)!;
    cur = moveNode(cur, id, parentId, dir === 1 ? pos.index + 2 : pos.index - 1);
  }
  return cur;
}

/** 選んだ部品 (と、その中) が参照する画面項目の ID */
export function selectedItemIds(nodes: readonly LayoutNode[], ids: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (list: readonly LayoutNode[]) => {
    for (const n of list) {
      if (n.itemRef && !out.includes(n.itemRef)) out.push(n.itemRef);
      if (n.children) walk(n.children);
    }
  };
  for (const id of normalizeSelection(nodes, ids)) { const n = findNode(nodes, id); if (n) walk([n]); }
  return out;
}

/** 選んだ項目に、同じ変更を一度に当てる */
export function docPatchItems(doc: LayoutDoc, itemIds: readonly string[], patch: (item: ScreenItem) => ScreenItem): LayoutDoc {
  const set = new Set(itemIds);
  return { ...doc, items: doc.items.map((i) => (set.has(i.id as string) ? patch(i) : i)) };
}
