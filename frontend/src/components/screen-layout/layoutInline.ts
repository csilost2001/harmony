/**
 * 画面デザイナの「文言をその場で編集」(UI 改善提案 第 3 弾 #41)。画面に依存しない純関数。
 * ダブルクリック / F2 で、見出し・文章・ボタン・リンク・区画の表題・タブ名・項目の表示名を、紙面の上で直す。
 */
import { findNode, updateNode, walkLayout, type LayoutNode, type LayoutNodeType } from "@harmony/shared";
import type { ScreenItem } from "../../types/v3/screen-item";
import { docUpdateItem, type LayoutDoc } from "./layoutModel";

export interface InlineTarget {
  value: string;
  /** 文章のように複数行を持てるか (Shift+Enter で改行) */
  multiline: boolean;
  /** 空のときに出す、薄い表示 */
  placeholder: string;
  /** どこに書くか (画面の表示に出る文言を、紙面から直す) */
  field: "text" | "label" | "title" | "itemLabel";
}

const TITLE_TYPES: ReadonlySet<LayoutNodeType> = new Set(["section", "form", "search-panel", "tab"]);

/** その場で直せる文言。直せない部品 (入れ物の本体・区切り線・独自部品など) は null */
export function inlineTarget(node: LayoutNode, item: ScreenItem | undefined): InlineTarget | null {
  const p = node.props ?? {};
  if (node.type === "heading") return { value: p.text ?? "", multiline: false, placeholder: "見出し", field: "text" };
  if (node.type === "text") return { value: p.text ?? "", multiline: true, placeholder: "文章", field: "text" };
  if (node.type === "button") return { value: p.label ?? (item?.label as string | undefined) ?? "", multiline: false, placeholder: "ボタン", field: "label" };
  if (node.type === "link") return { value: p.label ?? "", multiline: false, placeholder: "リンク", field: "label" };
  if (TITLE_TYPES.has(node.type)) return { value: p.title ?? "", multiline: false, placeholder: node.type === "tab" ? "タブ" : "表題", field: "title" };
  if (node.type === "field" && item) return { value: (item.label as string) ?? "", multiline: false, placeholder: "表示名", field: "itemLabel" };
  if (node.type === "table") return { value: p.title ?? (item?.label as string | undefined) ?? "", multiline: false, placeholder: "一覧の表題", field: "title" };
  return null;
}

/** 文言を書き込む。項目の表示名は空にできない (空のときは変えない) */
export function applyInline(doc: LayoutDoc, nodeId: string, value: string): LayoutDoc {
  const nodes = doc.layout?.nodes ?? [];
  const node = findNode(nodes, nodeId);
  if (!doc.layout || !node) return doc;
  const item = node.itemRef ? doc.items.find((i) => i.id === node.itemRef) : undefined;
  const target = inlineTarget(node, item);
  if (!target) return doc;
  if (target.field === "itemLabel") {
    if (!value.trim() || !node.itemRef) return doc;
    return docUpdateItem(doc, node.itemRef, (i) => ({ ...i, label: value as ScreenItem["label"] }));
  }
  const key = target.field;
  return {
    ...doc,
    layout: {
      ...doc.layout,
      nodes: updateNode(nodes, nodeId, (n) => {
        const props = { ...(n.props ?? {}) };
        if (value === "" && key !== "text") delete props[key]; else props[key] = value;
        return { ...n, props };
      }),
    },
  };
}

/** 紙面の上から下へ辿った順の、その場で直せる部品 (Tab / Shift+Tab で次へ移る順) */
export function inlineIds(nodes: readonly LayoutNode[], items: readonly ScreenItem[]): string[] {
  const out: string[] = [];
  walkLayout(nodes, (n) => {
    const item = n.itemRef ? items.find((i) => i.id === n.itemRef) : undefined;
    if (inlineTarget(n, item)) out.push(n.id);
  });
  return out;
}
