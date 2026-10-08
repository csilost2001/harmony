/**
 * 業務部品デザイナのモデル操作 (React 非依存の純関数)。
 * - パレットから置く部品の初期形
 * - テーブル列 → 画面項目 (型・桁・必須を引き継ぐ)
 * - 画面項目 → 置くべき部品 (項目 / 一覧表 / ボタン)
 * - 部品と項目をまとめて扱う操作 (追加・削除・複製)
 */
import {
  findNode, insertNode, nextNodeId, removeNode, cloneNode, findParent, collectItemRefs, collectExpandedItemRefs, walkLayout, updateNode,
  type LayoutComponentDef, type LayoutNode, type LayoutNodeType, type ScreenLayout,
} from "@harmony/shared";
import type { Column, DataType, Table } from "../../types/v3/table";
import type { ScreenItem } from "../../types/v3/screen-item";
import type { FieldType } from "../../types/v3/common";

export interface LayoutDoc {
  items: ScreenItem[];
  layout?: ScreenLayout;
}

/** 新規画面・空の画面のレイアウト */
export function emptyLayout(title?: string): ScreenLayout {
  return {
    version: 1,
    nodes: title ? [{ id: "pageTitle", type: "heading", props: { text: title, level: 1 } }] : [],
  };
}

/** パレットの部品を置くときの初期形 (field / table は項目を同時に作るため別関数) */
export function createNode(type: LayoutNodeType, existing: readonly LayoutNode[]): LayoutNode {
  const id = (base: string) => nextNodeId(existing, base);
  switch (type) {
    case "section": return { id: id("section"), type, props: { title: "区画", variant: "card" }, children: [] };
    case "form": return { id: id("form"), type, props: { columns: 2 }, children: [] };
    case "search-panel": return { id: id("searchPanel"), type, props: { columns: 3 }, children: [] };
    case "columns": {
      const pool = [...existing, { id: "columns", type } as LayoutNode];
      const a = nextNodeId(pool, "column");
      const b = nextNodeId([...pool, { id: a, type: "column" }], "column");
      return { id: id("columns"), type, children: [
        { id: a, type: "column", props: { span: 6 }, children: [] },
        { id: b, type: "column", props: { span: 6 }, children: [] },
      ] };
    }
    case "column": return { id: id("column"), type, props: { span: 6 }, children: [] };
    case "tabs": {
      const t = nextNodeId([...existing, { id: "tabs", type }], "tab");
      return { id: id("tabs"), type, children: [{ id: t, type: "tab", props: { title: "タブ 1" }, children: [] }] };
    }
    case "tab": return { id: id("tab"), type, props: { title: "新しいタブ" }, children: [] };
    case "button-bar": return { id: id("buttons"), type, props: { align: "right" }, children: [] };
    case "heading": return { id: id("heading"), type, props: { text: "見出し", level: 2 } };
    case "text": return { id: id("text"), type, props: { text: "文章を入力してください" } };
    case "button": return { id: id("button"), type, props: { label: "ボタン", variant: "secondary" } };
    case "link": return { id: id("link"), type, props: { label: "リンク" } };
    case "message-area": return { id: id("messageArea"), type };
    case "image": return { id: id("image"), type, props: { alt: "画像" } };
    case "divider": return { id: id("divider"), type };
    case "html": return { id: id("html"), type, props: { html: "<p>自由 HTML</p>" } };
    case "field": return { id: id("field"), type };
    case "table": return { id: id("table"), type };
    // 参照部品は定義 (createComponentNode) から作る。パレットの汎用の部品としては置かない
    case "component": return { id: id("component"), type };
  }
}

/** 画面項目 ID として未使用の lowerCamelCase を返す */
export function nextItemId(items: readonly ScreenItem[], base: string): string {
  const used = new Set(items.map((i) => i.id as string));
  const stem = toCamel(base) || "item";
  if (!used.has(stem)) return stem;
  for (let n = 2; ; n++) if (!used.has(`${stem}${n}`)) return `${stem}${n}`;
}

export function toCamel(raw: string): string {
  const parts = raw.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return "";
  const s = parts.map((p, i) => (i === 0 ? p.charAt(0).toLowerCase() + p.slice(1) : p.charAt(0).toUpperCase() + p.slice(1))).join("");
  return /^[a-z]/.test(s) ? s : "";
}

/** DB の型 → 画面項目の型 */
export function dataTypeToFieldType(dt: DataType | string): FieldType {
  const t = String(dt).toUpperCase();
  if (/INT|SERIAL/.test(t)) return "integer";
  if (/DECIMAL|NUMERIC|FLOAT|DOUBLE|REAL|MONEY/.test(t)) return "number";
  if (/BOOL/.test(t)) return "boolean";
  if (t === "DATE") return "date";
  if (/TIMESTAMP|DATETIME/.test(t)) return "datetime";
  if (/JSON/.test(t)) return "json";
  return "string";
}

/** テーブル列から画面項目を作る (型・桁・必須・表示名・DB 列への参照を引き継ぐ) */
export function itemFromColumn(table: Table, col: Column, items: readonly ScreenItem[], direction: "in" | "out" | "both" = "in"): ScreenItem {
  const type = dataTypeToFieldType(col.dataType);
  const item: ScreenItem = {
    id: nextItemId(items, col.physicalName) as ScreenItem["id"],
    label: col.name as ScreenItem["label"],
    type,
    direction,
    binding: { kind: "tableColumn", ref: { tableId: table.id, columnId: col.id } },
  } as ScreenItem;
  if (direction !== "out") {
    if (col.notNull && !col.autoIncrement && !col.defaultValue) item.required = true;
    if (type === "string" && col.length) item.maxLength = col.length;
  }
  if (col.description || col.comment) item.description = (col.comment ?? col.description) as ScreenItem["description"];
  return item;
}

/** 画面項目を置くときの部品種別 */
export function nodeTypeForItem(item: ScreenItem): LayoutNodeType {
  const k = item.presentation?.kind;
  if (k === "table" || k === "list" || k === "kanban" || k === "calendar") return "table";
  if (typeof item.type === "object" && item.type && (item.type as { kind?: string }).kind === "array") return "table";
  if (typeof item.type === "string" && /button/i.test(item.type)) return "button";
  return "field";
}

/** 画面項目を参照する部品を作る */
export function nodeForItem(item: ScreenItem, existing: readonly LayoutNode[]): LayoutNode {
  const type = nodeTypeForItem(item);
  // 独自部品の定義編集では項目 ID が {{差し込み口}} 形式なので、部品 ID には記号を除いた名前を使う
  return { id: nextNodeId(existing, (item.id as string).replace(/[{}\s]/g, "")), type, itemRef: item.id as string };
}

/** 新規の入力項目 (string) と、それを置く部品 */
export function newFieldWithItem(doc: LayoutDoc, kind: "field" | "table"): { item: ScreenItem; node: LayoutNode } {
  const nodes = doc.layout?.nodes ?? [];
  if (kind === "table") {
    const id = nextItemId(doc.items, "rows");
    const item = {
      id, label: "一覧", type: { kind: "array", itemType: "json" }, direction: "out",
      presentation: { kind: "table", columns: [
        { id: "col1", label: "列 1", path: "col1", type: "string" },
        { id: "col2", label: "列 2", path: "col2", type: "string" },
      ] },
    } as unknown as ScreenItem;
    return { item, node: { id: nextNodeId(nodes, id), type: "table", itemRef: id } };
  }
  const id = nextItemId(doc.items, "newField");
  const item = { id, label: "新しい項目", type: "string", direction: "in" } as ScreenItem;
  return { item, node: { id: nextNodeId(nodes, id), type: "field", itemRef: id } };
}

// ── 部品 + 項目を同時に扱う操作 ────────────────────────────────────────────

/** 部品を挿入する (layout が無ければ作る) */
export function docInsert(doc: LayoutDoc, parentId: string | null, node: LayoutNode, index?: number, newItems: ScreenItem[] = []): LayoutDoc {
  const layout = doc.layout ?? emptyLayout();
  return {
    items: [...doc.items, ...newItems.filter((n) => !doc.items.some((i) => i.id === n.id))],
    layout: { ...layout, nodes: insertNode(layout.nodes, parentId, node, index) },
  };
}

/**
 * 部品を削除する。removeItems が true なら、削除した部品だけが参照していた画面項目も削除する
 * (他の部品からも参照されている項目は残す)。
 */
export function docRemove(doc: LayoutDoc, nodeId: string, removeItems: boolean, defs: readonly LayoutComponentDef[] = []): { doc: LayoutDoc; removedItemIds: string[] } {
  if (!doc.layout) return { doc, removedItemIds: [] };
  const { nodes, removed } = removeNode(doc.layout.nodes, nodeId);
  if (!removed) return { doc, removedItemIds: [] };
  let items = doc.items;
  const removedItemIds: string[] = [];
  if (removeItems) {
    // 独自部品の中 (args 経由) で使われている項目も「まだ使われている」とみなす
    const stillUsed = collectExpandedItemRefs(nodes, defs);
    const refs = collectItemRefs([removed]);
    for (const r of refs) if (!stillUsed.has(r)) removedItemIds.push(r);
    items = items.filter((i) => !removedItemIds.includes(i.id as string));
  }
  return { doc: { items, layout: { ...doc.layout, nodes } }, removedItemIds };
}

/** 部品を複製して直後に置く。項目を参照する部品は、項目も複製して新しい ID を振る */
export function docDuplicate(doc: LayoutDoc, nodeId: string): { doc: LayoutDoc; newId: string | null } {
  if (!doc.layout) return { doc, newId: null };
  const src = findNode(doc.layout.nodes, nodeId);
  const pos = findParent(doc.layout.nodes, nodeId);
  if (!src || !pos) return { doc, newId: null };
  const copy = cloneNode(doc.layout.nodes, src);
  let items = [...doc.items];
  walkLayout([copy], (n) => {
    if (!n.itemRef) return;
    const orig = items.find((i) => i.id === n.itemRef);
    if (!orig) return;
    const nid = nextItemId(items, n.itemRef);
    items = [...items, { ...structuredClone(orig), id: nid as ScreenItem["id"], label: `${orig.label} (複製)` as ScreenItem["label"] }];
    n.itemRef = nid;
  });
  const nodes = insertNode(doc.layout.nodes, pos.parent?.id ?? null, copy, pos.index + 1);
  return { doc: { items, layout: { ...doc.layout, nodes } }, newId: copy.id };
}

/** 画面項目を更新する */
export function docUpdateItem(doc: LayoutDoc, itemId: string, patch: (item: ScreenItem) => ScreenItem): LayoutDoc {
  return { ...doc, items: doc.items.map((i) => (i.id === itemId ? patch(i) : i)) };
}

/** 部品 ID を変更する (画面内で一意であること) */
export function isValidNodeId(id: string, nodes: readonly LayoutNode[], currentId: string): string | null {
  if (!/^[a-z][a-zA-Z0-9]*$/.test(id)) return "英小文字で始まる英数字 (lowerCamelCase) で入力してください";
  if (id !== currentId && findNode(nodes, id)) return `「${id}」は既に使われています`;
  return null;
}

/** id の部品を別の部品の並び (0 個以上) に置き換える。独自部品の登録・展開に使う */
export function docReplaceNode(doc: LayoutDoc, nodeId: string, replacement: LayoutNode[]): LayoutDoc {
  if (!doc.layout) return doc;
  const pos = findParent(doc.layout.nodes, nodeId);
  if (!pos) return doc;
  // 先に取り除いてから同じ位置へ入れる (置き換え後の部品が元と同じ ID でも消えない)
  let nodes = removeNode(doc.layout.nodes, nodeId).nodes;
  replacement.forEach((n, k) => { nodes = insertNode(nodes, pos.parent?.id ?? null, n, pos.index + k); });
  return { ...doc, layout: { ...doc.layout, nodes } };
}

/** 参照部品の差し込み値を 1 つ更新する (空にすると取り除く) */
export function setComponentArg(nodes: readonly LayoutNode[], nodeId: string, paramId: string, value: string): LayoutNode[] {
  return updateNode(nodes, nodeId, (n) => {
    const args = { ...(n.args ?? {}) };
    if (value === "") delete args[paramId]; else args[paramId] = value;
    const next: LayoutNode = { ...n, args };
    if (Object.keys(args).length === 0) delete next.args;
    return next;
  });
}
