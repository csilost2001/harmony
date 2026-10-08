import { describe, it, expect } from "vitest";
import {
  buildComponentDef, createComponentNode, detachComponentNode, expandLayout, suggestParams,
  validateComponentDefs, validateLayoutWithComponents,
  type LayoutComponentDef, type LayoutNode,
} from "@harmony/shared";

const searchBox: LayoutComponentDef = {
  id: "search-box",
  label: "キーワード検索",
  params: [
    { id: "title", label: "表題", kind: "text", default: "検索条件" },
    { id: "keyword", label: "キーワード項目", kind: "item" },
    { id: "go", label: "遷移先", kind: "screen", default: "product-search" },
  ],
  nodes: [
    { id: "panel", type: "search-panel", props: { title: "{{title}}" }, children: [
      { id: "kw", type: "field", itemRef: "{{keyword}}" },
      { id: "bar", type: "button-bar", children: [{ id: "btn", type: "button", props: { label: "検索", screenRef: "{{go}}" } }] },
    ] },
  ],
};

const screenNodes: LayoutNode[] = [
  { id: "heading", type: "heading", props: { text: "商品", level: 1 } },
  { id: "box1", type: "component", componentRef: "search-box", args: { keyword: "productName", title: "商品を探す" } },
];

describe("expandLayout", () => {
  it("差し込み口を埋めて展開し、ID に参照部品の ID を前置する", () => {
    const { nodes, issues } = expandLayout(screenNodes, [searchBox]);
    expect(issues).toEqual([]);
    const panel = nodes[1];
    expect(panel).toMatchObject({ id: "box1__panel", type: "search-panel", via: "box1", props: { title: "商品を探す" } });
    expect(panel.children?.[0]).toMatchObject({ id: "box1__kw", itemRef: "productName" });
    // 未指定の screen 差し込み口は既定値
    expect(panel.children?.[1].children?.[0].props?.screenRef).toBe("product-search");
  });

  it("元の木は書き換えない", () => {
    const before = JSON.stringify([searchBox, screenNodes]);
    expandLayout(screenNodes, [searchBox]);
    expect(JSON.stringify([searchBox, screenNodes])).toBe(before);
  });

  it("定義が無い参照・循環・未設定の項目は問題として返す", () => {
    const unknown = expandLayout([{ id: "x", type: "component", componentRef: "nothing" }], []);
    expect(unknown.issues[0]).toMatchObject({ code: "unknown-component", nodeId: "x" });
    const loop: LayoutComponentDef = { id: "loop", label: "ループ", params: [], nodes: [{ id: "self", type: "component", componentRef: "loop" }] };
    expect(expandLayout([{ id: "y", type: "component", componentRef: "loop" }], [loop]).issues.some((i) => i.code === "component-cycle")).toBe(true);
    const noArg = expandLayout([{ id: "z", type: "component", componentRef: "search-box" }], [searchBox]);
    expect(noArg.issues.some((i) => i.code === "missing-arg" && i.message.includes("キーワード項目"))).toBe(true);
  });

  it("独自部品の入れ子を展開する", () => {
    const outer: LayoutComponentDef = { id: "outer", label: "外側", params: [{ id: "kw", label: "項目", kind: "item" }], nodes: [
      { id: "wrap", type: "section", children: [{ id: "inner", type: "component", componentRef: "search-box", args: { keyword: "{{kw}}" } }] },
    ] };
    const { nodes, issues } = expandLayout([{ id: "o", type: "component", componentRef: "outer", args: { kw: "q" } }], [searchBox, outer]);
    expect(issues).toEqual([]);
    expect(nodes[0].children?.[0].children?.[0].itemRef).toBe("q");
  });
});

describe("validateLayoutWithComponents", () => {
  const items = [{ id: "productName", label: "商品名" }, { id: "other", label: "その他" }];
  it("独自部品の中の項目も配置済みとして数え、未配置は他の項目だけになる", () => {
    const issues = validateLayoutWithComponents({ version: 1, nodes: screenNodes }, items, [searchBox]);
    expect(issues.filter((i) => i.code === "unplaced-item").map((i) => i.itemId)).toEqual(["other"]);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });
  it("独自部品の中の問題 (存在しない項目) は参照部品の問題として返す", () => {
    const bad: LayoutNode[] = [{ id: "box1", type: "component", componentRef: "search-box", args: { keyword: "ghost" } }];
    const issues = validateLayoutWithComponents({ version: 1, nodes: bad }, items, [searchBox]);
    expect(issues.find((i) => i.code === "missing-item")).toMatchObject({ nodeId: "box1", itemId: "ghost" });
  });
  it("参照部品を置けない場所 (ボタン群の中) はエラー", () => {
    const nodes: LayoutNode[] = [{ id: "bar", type: "button-bar", children: [{ id: "c", type: "component", componentRef: "search-box", args: { keyword: "productName" } }] }];
    expect(validateLayoutWithComponents({ version: 1, nodes }, items, [searchBox]).some((i) => i.code === "invalid-child" && i.nodeId === "c")).toBe(true);
  });
});

describe("登録 (画面の部品 → 独自部品)", () => {
  const nodes: LayoutNode[] = [{ id: "p", type: "search-panel", props: { title: "商品検索" }, children: [
    { id: "name", type: "field", itemRef: "productName" },
    { id: "go", type: "button", props: { label: "検索", screenRef: "product-search" } },
  ] }];
  const items = [{ id: "productName", label: "商品名" }];

  it("差し込み口の候補: 画面項目は既定で選ばれ、文言・遷移先は選ばれない", () => {
    const c = suggestParams(nodes, items);
    expect(c.filter((x) => x.suggested).map((x) => x.kind + ":" + x.value)).toEqual(["item:productName"]);
    expect(c.map((x) => x.kind)).toEqual(expect.arrayContaining(["item", "text", "screen"]));
  });

  it("選んだ候補が {{差し込み口}} になり、置き換え用の args は元の値を持つ。展開すると元の木に戻る", () => {
    const cands = suggestParams(nodes, items);
    const picked = cands.filter((c) => c.kind === "item" || (c.kind === "text" && c.prop === "title"));
    const { def, args } = buildComponentDef({
      id: "product-search-panel", label: "商品検索パネル", nodes,
      params: picked.map((c) => ({ candidate: c, paramId: c.kind === "item" ? "keyword" : "title", label: c.label })),
    });
    expect(def.nodes[0].props?.title).toBe("{{title}}");
    expect(def.nodes[0].children?.[0].itemRef).toBe("{{keyword}}");
    expect(def.params.find((p) => p.id === "title")?.default).toBe("商品検索");
    expect(validateComponentDefs([def]).filter((i) => i.severity === "error")).toEqual([]);
    const inst = createComponentNode(def, [], args);
    const back = expandLayout([inst], [def]).nodes[0];
    expect(back.props?.title).toBe("商品検索");
    expect(back.children?.[0].itemRef).toBe("productName");
    expect(back.children?.[1].props?.screenRef).toBe("product-search");
  });

  it("展開して通常の部品に戻すと、ID は画面内で重ならず、独自部品とのつながりは無くなる", () => {
    const detached = detachComponentNode(screenNodes[1], [searchBox], screenNodes);
    const ids: string[] = [];
    const walk = (ns: LayoutNode[]) => ns.forEach((n) => { ids.push(n.id); if (n.children) walk(n.children); });
    walk([...screenNodes.slice(0, 1), ...detached]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(detached)).not.toContain("via");
    expect(JSON.stringify(detached)).not.toContain("component");
  });
});

describe("validateComponentDefs", () => {
  it("未定義の差し込み口・不正 ID・循環を検出する", () => {
    const bad: LayoutComponentDef = { id: "Bad_Id", label: "不正", params: [{ id: "a", label: "a", kind: "text" }], nodes: [{ id: "t", type: "text", props: { text: "{{b}}" } }] };
    const codes = validateComponentDefs([bad]).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["bad-component-id", "undeclared-param", "unused-param"]));
    const a: LayoutComponentDef = { id: "a-part", label: "A", params: [], nodes: [{ id: "x", type: "component", componentRef: "b-part" }] };
    const b: LayoutComponentDef = { id: "b-part", label: "B", params: [], nodes: [{ id: "y", type: "component", componentRef: "a-part" }] };
    expect(validateComponentDefs([a, b]).some((i) => i.code === "component-cycle")).toBe(true);
  });
});
