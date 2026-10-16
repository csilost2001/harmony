import { describe, it, expect } from "vitest";
import type { LayoutNode } from "@harmony/shared";
import type { ScreenItem } from "../../types/v3/screen-item";
import type { LayoutDoc } from "./layoutModel";
import {
  canWrap, docDuplicateMany, docPatchItems, docRemoveMany, docWrap, moveManyInSiblings, normalizeSelection, rangeSelect,
  selectedItemIds, sharedParentId, toggleSelection,
} from "./layoutSelection";

const item = (id: string, over: Record<string, unknown> = {}) => ({ id, label: id, type: "string", direction: "in", ...over }) as unknown as ScreenItem;
const tree = (): LayoutNode[] => [
  { id: "title", type: "heading", props: { text: "見出し" } },
  { id: "form1", type: "form", props: { columns: 2 }, children: [
    { id: "fa", type: "field", itemRef: "a" },
    { id: "fb", type: "field", itemRef: "b" },
    { id: "fc", type: "field", itemRef: "c" },
  ] },
  { id: "bar", type: "button-bar", children: [{ id: "ok", type: "button", props: { label: "OK" } }, { id: "ng", type: "button", props: { label: "NG" } }] },
];
const doc = (): LayoutDoc => ({ items: [item("a"), item("b"), item("c")], layout: { version: 1, nodes: tree() } });
const ids = (nodes: readonly LayoutNode[]): string[] => nodes.flatMap((n) => [n.id, ...(n.children ? ids(n.children) : [])]);

describe("normalizeSelection", () => {
  it("存在しない部品を外し、親も選ばれている部品は親にまとめ、見た目の順に並べる", () => {
    expect(normalizeSelection(tree(), ["fb", "ghost", "fa"])).toEqual(["fa", "fb"]);
    expect(normalizeSelection(tree(), ["fa", "form1", "title"])).toEqual(["title", "form1"]);
    expect(normalizeSelection(tree(), ["fa", "fa"])).toEqual(["fa"]);
  });
});

describe("rangeSelect / toggleSelection", () => {
  it("同じ親の兄弟どうしなら、間をすべて選ぶ (向きは問わない)", () => {
    expect(rangeSelect(tree(), "fa", "fc")).toEqual(["fa", "fb", "fc"]);
    expect(rangeSelect(tree(), "fc", "fb")).toEqual(["fb", "fc"]);
  });
  it("違う親なら、その 2 つだけ", () => {
    expect(rangeSelect(tree(), "fa", "ok")).toEqual(["fa", "ok"]);
  });
  it("Ctrl+クリックは、入れたり外したりする", () => {
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleSelection(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("sharedParentId", () => {
  it("同じ親の直下だけ ok", () => {
    expect(sharedParentId(tree(), ["fa", "fb"])).toEqual({ ok: true, parentId: "form1" });
    expect(sharedParentId(tree(), ["title", "form1"])).toEqual({ ok: true, parentId: null });
    expect(sharedParentId(tree(), ["fa", "ok"]).ok).toBe(false);
  });
});

describe("docRemoveMany / docDuplicateMany", () => {
  it("まとめて削除すると、その部品だけが使っていた画面項目も消える", () => {
    const r = docRemoveMany(doc(), ["fa", "fc"]);
    expect(ids(r.doc.layout!.nodes)).not.toContain("fa");
    expect(ids(r.doc.layout!.nodes)).toContain("fb");
    expect(r.doc.items.map((i) => i.id)).toEqual(["b"]);
    expect(r.removedItemIds.sort()).toEqual(["a", "c"]);
  });
  it("親ごと選んだときは、親だけを 1 回削除する (中の部品を二重に消さない)", () => {
    const r = docRemoveMany(doc(), ["form1", "fa"]);
    expect(ids(r.doc.layout!.nodes)).toEqual(["title", "bar", "ok", "ng"]);
    expect(r.doc.items).toEqual([]);
  });
  it("まとめて複製すると、それぞれの直後に新しい ID で置き、項目も複製する", () => {
    const r = docDuplicateMany(doc(), ["fa", "fb"]);
    expect(r.newIds).toHaveLength(2);
    const form = r.doc.layout!.nodes.find((n) => n.id === "form1")!;
    expect(form.children!.map((c) => c.id).slice(0, 1)).toEqual(["fa"]);
    expect(form.children).toHaveLength(5);
    expect(new Set(ids(r.doc.layout!.nodes)).size).toBe(ids(r.doc.layout!.nodes).length); // ID の重複なし
    expect(r.doc.items).toHaveLength(5);
  });
});

describe("docWrap", () => {
  it("同じ親の部品を、新しい入れ物で包み、先頭の位置に置く", () => {
    const r = docWrap(doc(), ["fa", "fb"], "section");
    expect(r.wrapperId).toBe("section");
    const form = r.doc.layout!.nodes.find((n) => n.id === "form1")!;
    expect(form.children!.map((c) => c.id)).toEqual(["section", "fc"]);
    expect(form.children![0].children!.map((c) => c.id)).toEqual(["fa", "fb"]);
  });
  it("選んだ部品が「section」でも、入れ物の ID は、それと重ならない (ID で部品を探す操作が、どちらか決まるように)", () => {
    const d: LayoutDoc = { items: [], layout: { version: 1, nodes: [{ id: "section", type: "section", props: { title: "区画" }, children: [] }, { id: "tail", type: "text", props: { text: "x" } }] } };
    const r = docWrap(d, ["section", "tail"], "section");
    expect(r.wrapperId).toBe("section2");
    const all = ids(r.doc.layout!.nodes);
    expect(new Set(all).size).toBe(all.length);
  });
  it("入れ物が入れられない種類 (ボタン群にフォームなど)・違う親の組み合わせは包めない", () => {
    expect(canWrap(tree(), ["fa", "fb"], "button-bar")).toBe(false);
    expect(canWrap(tree(), ["fa", "ok"], "section")).toBe(false);
    expect(canWrap(tree(), ["ok", "ng"], "button-bar")).toBe(false); // ボタン群の中にボタン群は置けない
    expect(canWrap(tree(), ["title", "form1"], "section")).toBe(true);
    expect(docWrap(doc(), ["fa", "ok"], "section").wrapperId).toBeNull();
  });
});

describe("moveManyInSiblings", () => {
  it("同じ親の部品を、まとめて 1 つ下へ / 上へ動かす", () => {
    const down = moveManyInSiblings(tree(), ["fa", "fb"], 1);
    expect(down.find((n) => n.id === "form1")!.children!.map((c) => c.id)).toEqual(["fc", "fa", "fb"]);
    const up = moveManyInSiblings(down, ["fa", "fb"], -1);
    expect(up.find((n) => n.id === "form1")!.children!.map((c) => c.id)).toEqual(["fa", "fb", "fc"]);
  });
  it("端に着いている部品があれば、何も動かさない / 違う親の組み合わせも動かさない", () => {
    expect(moveManyInSiblings(tree(), ["fa", "fb"], -1)).toEqual(tree());
    expect(moveManyInSiblings(tree(), ["fb", "fc"], 1)).toEqual(tree());
    expect(moveManyInSiblings(tree(), ["fa", "ok"], 1)).toEqual(tree());
  });
});

describe("selectedItemIds / docPatchItems", () => {
  it("選んだ部品 (と中身) が参照する項目に、同じ変更を一度に当てる", () => {
    expect(selectedItemIds(tree(), ["form1"])).toEqual(["a", "b", "c"]);
    const next = docPatchItems(doc(), selectedItemIds(tree(), ["fa", "fb"]), (i) => ({ ...i, required: true }) as ScreenItem);
    expect(next.items.map((i) => (i as { required?: boolean }).required)).toEqual([true, true, undefined]);
  });
});
