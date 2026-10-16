/**
 * 画面項目の「区画」(UI 改善提案 続編 第 8 弾 #155)。画面の配置 (部品の木) で、項目が置かれている区画 (表題のある入れ物) の名前を求め、
 * 区画ごとに絞り込む・配置の順に並べ替える。画面に依存しない純関数。
 * 区画の名前: 項目を入れている、いちばん内側の、表題 (props.title) のある入れ物 (区画・フォーム・検索条件・タブ)。表題が無ければ、その外側へ。
 */
import type { LayoutNode } from "@harmony/shared";
import type { ScreenItem } from "../types/v3";

export const NO_SECTION = "(区画なし)";
export const UNPLACED = "(未配置)";

/** 項目 ID → 区画の名前 (配置に無い項目は UNPLACED、区画の外に置かれた項目は NO_SECTION) */
export function itemSections(nodes: readonly LayoutNode[] | undefined, items: readonly ScreenItem[]): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (list: readonly LayoutNode[], title: string | null) => {
    for (const n of list) {
      const t = n.props?.title?.trim() || null;
      const here = t ?? title;
      if (n.itemRef && !out.has(n.itemRef)) out.set(n.itemRef, here ?? NO_SECTION);
      if (n.children) walk(n.children, here);
    }
  };
  walk(nodes ?? [], null);
  for (const it of items) if (!out.has(String(it.id))) out.set(String(it.id), UNPLACED);
  return out;
}

/** 配置の順 (上から下・左から右) に、項目 ID を並べる。配置に無い項目は、元の順で末尾 */
export function layoutOrder(nodes: readonly LayoutNode[] | undefined, items: readonly ScreenItem[]): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const walk = (list: readonly LayoutNode[]) => {
    for (const n of list) {
      if (n.itemRef && !seen.has(n.itemRef)) { seen.add(n.itemRef); order.push(n.itemRef); }
      if (n.children) walk(n.children);
    }
  };
  walk(nodes ?? []);
  const known = new Set(items.map((i) => String(i.id)));
  const placed = order.filter((id) => known.has(id));
  return [...placed, ...items.map((i) => String(i.id)).filter((id) => !seen.has(id))];
}

/** 並べ替えの結果の項目の配列 (ID が重なる・空の ID があっても、すべての項目を残す) */
export function reorderItems(items: readonly ScreenItem[], orderIds: readonly string[]): ScreenItem[] {
  const rest = [...items];
  const out: ScreenItem[] = [];
  for (const id of orderIds) {
    const i = rest.findIndex((it) => String(it.id) === id);
    if (i >= 0) out.push(...rest.splice(i, 1));
  }
  return [...out, ...rest];
}
