import { describe, it, expect } from "vitest";
import {
  canContain, findNode, findParent, insertNode, moveNode, removeNode, updateNode,
  nextNodeId, cloneNode, validateLayout, collectItemRefs, type LayoutNode,
} from "@harmony/shared";

const tree = (): LayoutNode[] => [
  { id: "title", type: "heading", props: { text: "カート", level: 1 } },
  {
    id: "addForm", type: "form", props: { columns: 2 }, children: [
      { id: "productCode", type: "field", itemRef: "addProductCode" },
      { id: "quantity", type: "field", itemRef: "addQuantity" },
    ],
  },
  { id: "actions", type: "button-bar", children: [{ id: "addButton", type: "button", itemRef: "addToCartButton" }] },
];

describe("canContain", () => {
  it("段組の子は段のみ、段は段組の直下のみ", () => {
    expect(canContain("columns", "column")).toBe(true);
    expect(canContain("columns", "field")).toBe(false);
    expect(canContain(null, "column")).toBe(false);
    expect(canContain("section", "column")).toBe(false);
  });
  it("ボタン群にはボタンとリンクのみ置ける", () => {
    expect(canContain("button-bar", "button")).toBe(true);
    expect(canContain("button-bar", "field")).toBe(false);
  });
  it("要素部品は子を持てない", () => {
    expect(canContain("field", "text")).toBe(false);
  });
});

describe("木の操作", () => {
  it("findNode / findParent", () => {
    const t = tree();
    expect(findNode(t, "quantity")?.itemRef).toBe("addQuantity");
    expect(findParent(t, "quantity")).toEqual({ parent: t[1], index: 1 });
    expect(findParent(t, "title")).toEqual({ parent: null, index: 0 });
  });

  it("insertNode は新しい配列を返し元を変えない", () => {
    const t = tree();
    const next = insertNode(t, "addForm", { id: "note", type: "text" }, 0);
    expect(findNode(next, "addForm")?.children?.[0].id).toBe("note");
    expect(findNode(t, "addForm")?.children?.length).toBe(2);
  });

  it("removeNode は削除した部品を返す", () => {
    const { nodes, removed } = removeNode(tree(), "addForm");
    expect(removed?.children?.length).toBe(2);
    expect(findNode(nodes, "productCode")).toBeNull();
  });

  it("moveNode: 同じ親の中で後ろへ動かす", () => {
    const next = moveNode(tree(), "productCode", "addForm", 2);
    expect(findNode(next, "addForm")?.children?.map((c) => c.id)).toEqual(["quantity", "productCode"]);
  });

  it("moveNode: 別の容器へ移す", () => {
    const next = moveNode(tree(), "addButton", "addForm", 0);
    expect(findNode(next, "addForm")?.children?.[0].id).toBe("addButton");
    expect(findNode(next, "actions")?.children).toEqual([]);
  });

  it("moveNode: 置けない場所・自分の子孫への移動は無視する", () => {
    const t = tree();
    expect(moveNode(t, "productCode", "actions", 0)).toEqual(t);
    const nested: LayoutNode[] = [{ id: "a", type: "section", children: [{ id: "b", type: "section" }] }];
    expect(moveNode(nested, "a", "b", 0)).toEqual(nested);
  });

  it("updateNode は該当部品だけ差し替える", () => {
    const next = updateNode(tree(), "title", (n) => ({ ...n, props: { ...n.props, text: "買い物かご" } }));
    expect(findNode(next, "title")?.props?.text).toBe("買い物かご");
  });

  it("nextNodeId は未使用の lowerCamelCase ID を返す", () => {
    expect(nextNodeId(tree(), "quantity")).toBe("quantity2");
    expect(nextNodeId(tree(), "search-panel")).toBe("searchPanel");
    expect(nextNodeId([], "123")).toBe("node");
  });

  it("cloneNode は子孫の ID も振り直す", () => {
    const t = tree();
    const c = cloneNode(t, findNode(t, "addForm")!);
    expect(c.id).toBe("addForm2");
    expect(c.children?.map((x) => x.id)).toEqual(["productCode2", "quantity2"]);
    expect(c.children?.[0].itemRef).toBe("addProductCode");
  });

  it("collectItemRefs", () => {
    expect([...collectItemRefs(tree())].sort()).toEqual(["addProductCode", "addQuantity", "addToCartButton"]);
  });
});

describe("validateLayout", () => {
  const items = [
    { id: "addProductCode", label: "商品コード" },
    { id: "addQuantity", label: "数量" },
    { id: "addToCartButton", label: "カートに追加" },
    { id: "cartTotal", label: "合計" },
  ];

  it("整合した木では未配置項目だけを info で返す", () => {
    const issues = validateLayout({ version: 1, nodes: tree() }, items);
    expect(issues).toEqual([expect.objectContaining({ code: "unplaced-item", itemId: "cartTotal", severity: "info" })]);
  });

  it("重複 ID・存在しない項目・項目未割当・置けない位置を検出する", () => {
    const nodes: LayoutNode[] = [
      { id: "dup", type: "field", itemRef: "nothing" },
      { id: "dup", type: "table" },
      { id: "col", type: "column" },
    ];
    const codes = validateLayout({ version: 1, nodes }, []).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["duplicate-id", "missing-item", "item-required", "invalid-child"]));
  });

  it("layout がなければ何も返さない", () => {
    expect(validateLayout(undefined, items)).toEqual([]);
  });
});
