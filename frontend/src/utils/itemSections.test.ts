import { describe, it, expect } from "vitest";
import type { LayoutNode } from "@harmony/shared";
import type { ScreenItem } from "../types/v3";
import { itemSections, layoutOrder, NO_SECTION, reorderItems, UNPLACED } from "./itemSections";

const f = (id: string, itemRef: string): LayoutNode => ({ id, type: "field", itemRef });
const nodes: LayoutNode[] = [
  f("root-field", "title"),
  { id: "s1", type: "section", props: { title: "基本情報" }, children: [
    { id: "form1", type: "form", children: [f("n1", "name"), f("n2", "kana")] },
    { id: "form2", type: "form", props: { title: "連絡先" }, children: [f("n3", "tel")] },
  ] },
  { id: "s2", type: "search-panel", children: [f("n4", "keyword")] },
];
const items = ["kana", "name", "tel", "keyword", "title", "hidden"].map((id) => ({ id, label: id })) as unknown as ScreenItem[];

describe("itemSections (続編 第 8 弾 #155)", () => {
  const m = itemSections(nodes, items);
  it("いちばん内側の、表題のある入れ物の名前を返す", () => {
    expect(m.get("name")).toBe("基本情報"); // フォームに表題が無いので、外側の区画
    expect(m.get("tel")).toBe("連絡先");
    expect(m.get("keyword")).toBe(NO_SECTION); // 表題の無い検索条件
    expect(m.get("title")).toBe(NO_SECTION); // 区画の外
  });
  it("配置に無い項目は、未配置", () => { expect(m.get("hidden")).toBe(UNPLACED); });
  it("配置が無ければ、すべて未配置", () => { expect([...itemSections(undefined, items).values()].every((v) => v === UNPLACED)).toBe(true); });
});

describe("layoutOrder / reorderItems", () => {
  it("配置の順に並べ、未配置は元の順で末尾", () => {
    expect(layoutOrder(nodes, items)).toEqual(["title", "name", "kana", "tel", "keyword", "hidden"]);
  });
  it("並べ替えても、すべての項目が残る (重なる ID・配置に無い項目も)", () => {
    const dup = [...items, { id: "name", label: "重複" }] as unknown as ScreenItem[];
    const r = reorderItems(dup, layoutOrder(nodes, dup));
    expect(r).toHaveLength(dup.length);
    expect(r.map((i) => i.id).slice(0, 3)).toEqual(["title", "name", "kana"]);
    expect(r.filter((i) => i.id === "name")).toHaveLength(2);
  });
});
