import { describe, it, expect } from "vitest";
import { autoPlaceItems, isStateOnlyItem, itemNodeType, validateLayoutWithComponents, collectItemRefs, walkLayout, type LayoutNode, type ScreenLayout } from "@harmony/shared";

const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, type: "string", direction: "in", ...extra });
const layout = (nodes: LayoutNode[]): ScreenLayout => ({ version: 1, nodes });
const find = (nodes: LayoutNode[], id: string): LayoutNode | undefined => { let hit: LayoutNode | undefined; walkLayout(nodes, (n) => { if (n.id === id) hit = n; }); return hit; };

const base = layout([
  { id: "title", type: "heading", props: { text: "注文", level: 1 } },
  { id: "search", type: "search-panel", props: { columns: 2 }, children: [{ id: "q", type: "field", itemRef: "keyword" }] },
  { id: "entry", type: "form", props: { columns: 2 }, children: [
    { id: "name", type: "field", itemRef: "name" },
    { id: "bar", type: "button-bar", children: [{ id: "ok", type: "button", itemRef: "okButton" }] },
  ] },
  { id: "summary", type: "section", props: { variant: "panel" }, children: [{ id: "total", type: "field", itemRef: "total" }] },
]);
const placed = [item("keyword"), item("name"), item("okButton"), item("total", { direction: "out" })];

describe("itemNodeType", () => {
  it("一覧 / ボタン / 項目を見分ける", () => {
    expect(itemNodeType(item("rows", { type: { kind: "array", itemType: "json" }, direction: "out" }))).toBe("table");
    expect(itemNodeType(item("rows", { presentation: { kind: "list" } }))).toBe("table");
    expect(itemNodeType(item("saveButton"))).toBe("button");
    expect(itemNodeType(item("save", { label: "保存ボタン" }))).toBe("button");
    expect(itemNodeType(item("go", { events: [{ id: "click-go" }] }))).toBe("button");
    expect(itemNodeType(item("email"))).toBe("field");
  });
});

describe("autoPlaceItems", () => {
  const unplaced = [
    item("dateFromFilter"), item("memo"), item("itemCount", { direction: "out" }),
    item("cancelButton"), item("deleteButton"), item("rows", { type: { kind: "array", itemType: "json" }, direction: "out" }),
  ];
  const { layout: out, placements } = autoPlaceItems(base, [...placed, ...unplaced]);

  it("置き済みの項目には触れず、未配置の項目だけを置く", () => {
    expect(placements.map((p) => p.itemId).sort()).toEqual(unplaced.map((u) => u.id).sort());
    expect(base.nodes).toHaveLength(4); // 元は変えない
    const refs = collectItemRefs(out.nodes);
    for (const it of [...placed, ...unplaced]) expect(refs.has(it.id)).toBe(true);
  });

  it("絞り込みは検索条件、入力は入力フォーム、表示専用は項目を持つ区画、ボタンはボタン群、一覧は最上位の末尾", () => {
    const refIn = (containerId: string, itemId: string) => !!find(out.nodes, containerId)?.children?.some((c) => c.itemRef === itemId);
    expect(refIn("search", "dateFromFilter")).toBe(true);
    expect(refIn("entry", "memo")).toBe(true);
    expect(refIn("summary", "itemCount")).toBe(true);
    expect(refIn("bar", "cancelButton")).toBe(true);
    expect(refIn("bar", "deleteButton")).toBe(true);
    expect(out.nodes[out.nodes.length - 1]).toMatchObject({ type: "table", itemRef: "rows" });
  });

  it("ボタンの強調: 削除は danger、それ以外の既定は secondary", () => {
    expect(find(out.nodes, "deleteButton")?.props?.variant).toBe("danger");
    expect(find(out.nodes, "cancelButton")?.props?.variant).toBe("secondary");
  });

  it("配置後のレイアウトにエラーは無く、未配置も残らない。同じ入力からは同じ結果になる", () => {
    const issues = validateLayoutWithComponents(out, [...placed, ...unplaced], []);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(issues.filter((i) => i.code === "unplaced-item")).toEqual([]);
    expect(autoPlaceItems(base, [...placed, ...unplaced]).layout).toEqual(out);
  });

  it("容器が無い画面でも、入力フォーム / ボタン群を作って置く。表示専用は (項目を持つ区画が無ければ) 入力フォームに置く", () => {
    const empty = layout([{ id: "title", type: "heading", props: { text: "画面", level: 1 } }]);
    const r = autoPlaceItems(empty, [item("name"), item("shown", { direction: "out" }), item("saveButton")]);
    expect(r.layout.nodes.map((n) => n.type)).toEqual(["heading", "form"]);
    const form = r.layout.nodes[1];
    expect(form.children?.map((c) => c.type)).toEqual(["field", "field", "button-bar"]);
    expect(form.children?.[2].children?.[0]).toMatchObject({ type: "button", itemRef: "saveButton", props: { variant: "primary" } });
    // 入力も無く表示専用だけなら、表示項目の区画を作る
    const onlyOut = autoPlaceItems(empty, [item("shown", { direction: "out" })]);
    expect(onlyOut.layout.nodes.map((n) => n.type)).toEqual(["heading", "section"]);
    expect(validateLayoutWithComponents(r.layout, [item("name"), item("shown", { direction: "out" }), item("saveButton")], []).filter((i) => i.severity === "error")).toEqual([]);
  });

  it("表示専用の項目は、項目を持つ区画が無ければ、入力フォームを含まない区画 (注文サマリ等) に置く", () => {
    const l = layout([
      { id: "add", type: "section", children: [{ id: "addForm", type: "form", children: [{ id: "code", type: "field", itemRef: "code" }] }] },
      { id: "summary", type: "section", props: { title: "注文サマリ" }, children: [{ id: "note", type: "text", props: { text: "説明" } }] },
    ]);
    const r = autoPlaceItems(l, [item("code"), item("count", { direction: "out" })]);
    expect(r.placements).toEqual([{ itemId: "count", nodeId: "count", where: "表示用の区画" }]);
    expect(find(r.layout.nodes, "summary")?.children?.map((c) => c.id)).toEqual(["note", "count"]);
    expect(find(r.layout.nodes, "addForm")?.children?.map((c) => c.id)).toEqual(["code"]);
  });

  it("項目は、容器の中のボタン / ボタン群より前に置く (ボタンの後ろに項目が来ない)", () => {
    const l = layout([{ id: "f", type: "form", children: [
      { id: "a", type: "field", itemRef: "a" },
      { id: "go", type: "button", itemRef: "go", props: { label: "追加" } },
    ] }]);
    const r = autoPlaceItems(l, [item("a"), item("go"), item("b")]);
    expect(find(r.layout.nodes, "f")?.children?.map((c) => c.id)).toEqual(["a", "b", "go"]);
  });

  it("画面の内部状態だけの項目 (説明に「画面 state」と明記) は自動配置しない", () => {
    const state = item("selectedPhotoId", { description: "AI画像alt生成 button 押下時に対象となる photos[] の id を保持する画面 state。" });
    expect(isStateOnlyItem(state)).toBe(true);
    expect(isStateOnlyItem(item("name", { description: "氏名の入力欄" }))).toBe(false);
    expect(autoPlaceItems(layout([]), [state, item("name")]).placements.map((p) => p.itemId)).toEqual(["name"]);
  });

  it("独自部品の中 (差し込み値) で使われている項目は配置済みとみなし、置かない", () => {
    const defs = [{ id: "box", label: "箱", params: [{ id: "who", label: "項目", kind: "item" as const }], nodes: [{ id: "f", type: "field" as const, itemRef: "{{who}}" }] }];
    const l = layout([{ id: "c", type: "component", componentRef: "box", args: { who: "name" } }]);
    expect(autoPlaceItems(l, [item("name"), item("other")], defs).placements.map((p) => p.itemId)).toEqual(["other"]);
  });
});
