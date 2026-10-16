import { describe, it, expect } from "vitest";
import type { LayoutNode } from "@harmony/shared";
import type { ScreenItem } from "../../types/v3/screen-item";
import type { LayoutDoc } from "./layoutModel";
import { applyInline, inlineIds, inlineTarget } from "./layoutInline";

const item = (id: string, label: string) => ({ id, label, type: "string", direction: "in" }) as unknown as ScreenItem;
const doc = (): LayoutDoc => ({
  items: [item("name", "氏名"), item("rows", "一覧")],
  layout: { version: 1, nodes: [
    { id: "h", type: "heading", props: { text: "注文", level: 1 } },
    { id: "sec", type: "section", props: { title: "条件" }, children: [
      { id: "fName", type: "field", itemRef: "name" },
      { id: "t", type: "text", props: { text: "説明" } },
      { id: "sep", type: "divider" },
    ] },
    { id: "tbl", type: "table", itemRef: "rows" },
    { id: "ok", type: "button", props: { label: "登録" } },
  ] },
});
const find = (d: LayoutDoc, id: string): LayoutNode => {
  const walk = (ns: LayoutNode[]): LayoutNode | undefined => { for (const n of ns) { if (n.id === id) return n; const c = n.children && walk(n.children); if (c) return c; } };
  return walk(d.layout!.nodes)!;
};

describe("inlineTarget", () => {
  it("直せる文言と、複数行かどうか", () => {
    const d = doc();
    expect(inlineTarget(find(d, "h"), undefined)).toMatchObject({ value: "注文", multiline: false, field: "text" });
    expect(inlineTarget(find(d, "t"), undefined)).toMatchObject({ value: "説明", multiline: true });
    expect(inlineTarget(find(d, "sec"), undefined)).toMatchObject({ value: "条件", field: "title" });
    expect(inlineTarget(find(d, "fName"), d.items[0])).toMatchObject({ value: "氏名", field: "itemLabel" });
    expect(inlineTarget(find(d, "tbl"), d.items[1])).toMatchObject({ value: "一覧", field: "title" }); // 表題が無ければ項目の表示名
    expect(inlineTarget(find(d, "ok"), undefined)).toMatchObject({ value: "登録", field: "label" });
  });
  it("直せない部品は null (区切り線・項目を参照しない入力項目)", () => {
    expect(inlineTarget(find(doc(), "sep"), undefined)).toBeNull();
    expect(inlineTarget({ id: "x", type: "field" }, undefined)).toBeNull();
  });
});

describe("applyInline", () => {
  it("部品の文言を書き換える", () => {
    expect(find(applyInline(doc(), "h", "新しい見出し"), "h").props?.text).toBe("新しい見出し");
    expect(find(applyInline(doc(), "sec", "検索"), "sec").props?.title).toBe("検索");
    expect(find(applyInline(doc(), "ok", "確定"), "ok").props?.label).toBe("確定");
  });
  it("項目の表示名は、項目の定義の側を書き換える (部品には書かない)。空にはできない", () => {
    const r = applyInline(doc(), "fName", "お名前");
    expect(r.items.find((i) => i.id === "name")?.label).toBe("お名前");
    expect(find(r, "fName").props).toBeUndefined();
    expect(applyInline(doc(), "fName", "  ").items.find((i) => i.id === "name")?.label).toBe("氏名");
  });
  it("ボタン・表題を空にすると、指定を外して既定に戻す", () => {
    expect(find(applyInline(doc(), "ok", ""), "ok").props).toEqual({});
    expect(find(applyInline(doc(), "sec", ""), "sec").props?.title).toBeUndefined();
  });
  it("直せない部品・無い部品は、そのまま", () => {
    const d = doc();
    expect(applyInline(d, "sep", "x")).toBe(d);
    expect(applyInline(d, "ghost", "x")).toBe(d);
  });
});

describe("inlineIds", () => {
  it("紙面の上から下へ、直せる部品だけ", () => {
    const d = doc();
    expect(inlineIds(d.layout!.nodes, d.items)).toEqual(["h", "sec", "fName", "t", "tbl", "ok"]);
  });
});
