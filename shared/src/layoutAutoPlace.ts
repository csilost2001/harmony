/**
 * 未配置の画面項目を、画面の業務部品の木に自動で配置する (決定的な既定の置き場所)。
 *
 * 画面項目の定義 (items) だけがあり、画面のどこにも置かれていない項目 (旧デザインからの自動変換で
 * 対応する要素が無かった項目など) を、種類に応じた容器へ追加する。置き場所は設計者が後で直せる。
 *
 * 仕様: docs/spec/screen-layout.md「未配置の項目の自動配置」
 */
import {
  insertNode, nextNodeId, walkLayout,
  type LayoutNode, type ScreenLayout,
} from "./screenLayout.js";
import { collectExpandedItemRefs, type LayoutComponentDef } from "./layoutComponents.js";

export interface AutoPlaceItem {
  id: string;
  label?: string;
  type?: unknown;
  direction?: string;
  presentation?: { kind?: string };
  events?: ReadonlyArray<{ id?: string }>;
  nonVisual?: boolean;
}

/** 画面に表示しない項目 (画面項目の nonVisual)。画面の内部状態・隠し値なので自動配置しない */
export function isStateOnlyItem(item: AutoPlaceItem): boolean {
  return item.nonVisual === true;
}

export interface AutoPlacement {
  itemId: string;
  nodeId: string;
  /** どこに置いたか (表示用) */
  where: string;
}

const LISTY = new Set(["table", "list", "kanban", "calendar"]);

/** 画面項目を置くときの部品種別 (一覧 / ボタン / 入力・表示項目) */
export function itemNodeType(item: AutoPlaceItem): "table" | "button" | "field" {
  if (item.presentation?.kind && LISTY.has(item.presentation.kind)) return "table";
  const t = item.type as { kind?: string } | string | undefined;
  if (t && typeof t === "object" && t.kind === "array") return "table";
  if (typeof t === "string" && /button/i.test(t)) return "button";
  if (/button$/i.test(item.id) || /ボタン$/.test(item.label ?? "")) return "button";
  if ((item.events ?? []).some((e) => /^(click|press|submit)/i.test(e.id ?? ""))) return "button";
  return "field";
}

function buttonVariant(item: AutoPlaceItem): "primary" | "danger" | "secondary" {
  const s = `${item.id} ${item.label ?? ""}`;
  if (/delete|remove|削除|取消|取り消/i.test(s)) return "danger";
  if (/save|submit|create|register|add|search|confirm|update|保存|登録|追加|検索|確定|更新/i.test(s)) return "primary";
  return "secondary";
}

const isFilter = (item: AutoPlaceItem) => /filter$/i.test(item.id) || /絞り込み|絞込/.test(item.label ?? "");

function flatten(nodes: readonly LayoutNode[]): LayoutNode[] {
  const out: LayoutNode[] = [];
  walkLayout(nodes, (n) => { out.push(n); });
  return out;
}

const last = <T>(xs: readonly T[]): T | undefined => xs[xs.length - 1];

/**
 * 未配置の項目を自動配置した新しいレイアウトを返す (元は変更しない)。画面の内部状態だけの項目 (isStateOnlyItem) は置かない。
 *
 * - 一覧 (presentation が table / list 等、配列型) → 最上位の末尾に一覧表
 * - ボタン (型 / ID / 表示名 / click イベントで判定) → 入力フォーム (または検索条件) の中のボタン群。無ければ作る
 * - 表示専用 (direction=out) → 項目を持つ区画、無ければ入力フォームを含まない区画 (注文サマリ等)。それも無ければ入力フォーム、
 *   さらに無ければ「表示項目」の区画を作る
 * - 入力 (in / both) → 「…Filter」「絞り込み」は検索条件、それ以外は入力フォーム。無ければ「入力」フォームを作る
 */
export function autoPlaceItems(
  layout: ScreenLayout,
  items: readonly AutoPlaceItem[],
  defs: readonly LayoutComponentDef[] = [],
): { layout: ScreenLayout; placements: AutoPlacement[] } {
  const placedRefs = collectExpandedItemRefs(layout.nodes, defs);
  let nodes: LayoutNode[] = [...layout.nodes];
  const placements: AutoPlacement[] = [];
  const idPool = () => nodes;

  const push = (parent: LayoutNode | null, node: LayoutNode, where: string, itemId: string) => {
    // 項目は、容器の中のボタン / ボタン群 (操作の並び) より前に置く。最新の木から容器の子を読む
    let index: number | undefined;
    if (node.type === "field" && parent) {
      const kids = flatten(nodes).find((n) => n.id === parent.id)?.children ?? [];
      const at = kids.findIndex((c) => c.type === "button" || c.type === "button-bar");
      if (at >= 0) index = at;
    }
    nodes = insertNode(nodes, parent?.id ?? null, node, index);
    placements.push({ itemId, nodeId: node.id, where });
  };
  /** 容器を探す (最新の木から再探索する。直前の配置で増えた子も見える) */
  const find = (pred: (n: LayoutNode) => boolean): LayoutNode | undefined => last(flatten(nodes).filter(pred));
  const ensureContainer = (type: "form" | "section", title: string): LayoutNode => {
    const node: LayoutNode = type === "form"
      ? { id: nextNodeId(idPool(), "inputForm"), type, props: { title, columns: 2 }, children: [] }
      : { id: nextNodeId(idPool(), "displaySection"), type, props: { title, variant: "panel" }, children: [] };
    nodes = insertNode(nodes, null, node);
    return node;
  };

  for (const item of items) {
    if (placedRefs.has(item.id) || isStateOnlyItem(item)) continue;
    const kind = itemNodeType(item);
    const base = item.id.replace(/[^A-Za-z0-9]/g, "") || "item";

    if (kind === "table") {
      push(null, { id: nextNodeId(idPool(), base), type: "table", itemRef: item.id }, "最上位の末尾 (一覧表)", item.id);
      continue;
    }

    if (kind === "button") {
      let bar = find((n) => n.type === "button-bar" && flatten(nodes).some((p) => (p.type === "form" || p.type === "search-panel") && p.children?.some((c) => c.id === n.id)));
      bar ??= find((n) => n.type === "button-bar");
      if (!bar) {
        const host = find((n) => n.type === "form") ?? find((n) => n.type === "search-panel");
        bar = { id: nextNodeId(idPool(), "buttons"), type: "button-bar", props: { align: "right" }, children: [] };
        nodes = insertNode(nodes, host?.id ?? null, bar);
      }
      push(bar, { id: nextNodeId(idPool(), base), type: "button", itemRef: item.id, props: { variant: buttonVariant(item) } }, "ボタン群", item.id);
      continue;
    }

    const field: LayoutNode = { id: nextNodeId(idPool(), base), type: "field", itemRef: item.id };
    if (item.direction === "out") {
      // 項目を持つ区画 → 入力フォームを含まない区画 (注文サマリ等の表示用) → 入力フォーム → 表示項目の区画を作る
      const withField = find((n) => n.type === "section" && !!n.children?.some((c) => c.type === "field"));
      const displayOnly = find((n) => n.type === "section" && !n.children?.some((c) => c.type === "form" || c.type === "search-panel"));
      const section = withField ?? displayOnly;
      const host = section ?? find((n) => n.type === "form") ?? ensureContainer("section", "表示項目");
      push(host, field, withField ? "項目を持つ区画" : displayOnly ? "表示用の区画" : host.type === "form" ? "入力フォーム" : "表示項目の区画", item.id);
      continue;
    }

    const search = find((n) => n.type === "search-panel");
    const form = find((n) => n.type === "form");
    const host = (isFilter(item) ? search ?? form : form ?? search) ?? ensureContainer("form", "入力");
    push(host, field, host.type === "search-panel" ? "検索条件" : "入力フォーム", item.id);
  }

  return { layout: { ...layout, nodes }, placements };
}
