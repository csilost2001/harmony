import { describe, it, expect } from "vitest";
import { moveNode, type LayoutNode } from "@harmony/shared";
import { firstChildId, flattenIds, indentPlace, neighborId, outdentPlace, parentId } from "./layoutKeyboard";

const n = (id: string, type: LayoutNode["type"], children?: LayoutNode[]): LayoutNode => ({ id, type, ...(children ? { children } : {}) } as LayoutNode);
// section1 [ form1 [ f1, f2 ], text1 ], section2 [ ], cols [ col1 [ f3 ], col2 [ ] ], b1 (button at top)
const tree: LayoutNode[] = [
  n("section1", "section", [n("form1", "form", [n("f1", "field"), n("f2", "field")]), n("text1", "text")]),
  n("section2", "section", []),
  n("cols", "columns", [n("col1", "column", [n("f3", "field")]), n("col2", "column", [])]),
  n("b1", "button"),
];

describe("画面デザイナのキーボード操作 (木の中の移動)", () => {
  it("見た目の順 (木を上から下へ) に前後へ移れる。端では null", () => {
    expect(flattenIds(tree)).toEqual(["section1", "form1", "f1", "f2", "text1", "section2", "cols", "col1", "f3", "col2", "b1"]);
    expect(neighborId(tree, "section1", 1)).toBe("form1");
    expect(neighborId(tree, "f2", 1)).toBe("text1");
    expect(neighborId(tree, "section2", -1)).toBe("text1");
    expect(neighborId(tree, "section1", -1)).toBeNull();
    expect(neighborId(tree, "b1", 1)).toBeNull();
    expect(neighborId(tree, "nope", 1)).toBeNull();
  });

  it("親・最初の子へ移れる。最上位の部品に親はなく、子の無い部品に子はない", () => {
    expect(parentId(tree, "f2")).toBe("form1");
    expect(parentId(tree, "section1")).toBeNull();
    expect(firstChildId(tree, "form1")).toBe("f1");
    expect(firstChildId(tree, "f1")).toBeNull();
    expect(firstChildId(tree, "section2")).toBeNull();
  });
});

describe("入れ子の出入り", () => {
  it("外へ出す = 親の直後。最上位の部品は出せない", () => {
    expect(outdentPlace(tree, "text1")).toEqual({ parentId: null, index: 1 });
    expect(outdentPlace(tree, "f1")).toEqual({ parentId: "section1", index: 1 }); // form1 の外 = section1 の中の form1 の直後
    expect(outdentPlace(tree, "section1")).toBeNull();
  });

  it("出た先に置けない部品 (column・form から section へ出せない種類など) は出せない", () => {
    expect(outdentPlace(tree, "col1")).toBeNull(); // column は columns の直下だけ
    expect(outdentPlace(tree, "form1")).toEqual({ parentId: null, index: 1 });
  });

  it("中へ入れる = 直前の兄弟の最後の子。入れられない組み合わせ・先頭の部品は入れない", () => {
    expect(indentPlace(tree, "text1")).toEqual({ parentId: "form1", index: 2 }); // 直前の兄弟 form1 に、text を置ける
    expect(indentPlace(tree, "cols")).toEqual({ parentId: "section2", index: 0 });
    expect(indentPlace(tree, "section1")).toBeNull(); // 先頭
    expect(indentPlace(tree, "b1")).toBeNull(); // 直前は columns。button は columns に置けない
    expect(indentPlace(tree, "f2")).toBeNull(); // 直前は f1 (field は子を持てない)
  });

  it("出す・入れる先は、moveNode でそのまま使え、木の構造が壊れない", () => {
    const out = outdentPlace(tree, "text1")!;
    const moved = moveNode(tree, "text1", out.parentId, out.index);
    expect(parentId(moved, "text1")).toBeNull();
    const inn = indentPlace(moved, "cols")!;
    const moved2 = moveNode(moved, "cols", inn.parentId, inn.index);
    expect(inn).toEqual({ parentId: "section2", index: 0 });
    expect(parentId(moved2, "cols")).toBe("section2");
    expect(flattenIds(moved2)).toHaveLength(flattenIds(tree).length); // 部品は増えも減りもしない
  });
});
