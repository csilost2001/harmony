import { describe, it, expect } from "vitest";
import { dropIndex, moveItem, remapIndex, remapIndexSet } from "./rowReorder";

describe("moveItem", () => {
  it("行を別の位置へ動かす。範囲外・同じ位置は動かさない", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(moveItem(["a", "b"], 0, 0)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 0, 5)).toEqual(["a", "b"]);
  });
});

describe("dropIndex", () => {
  it("行の前 / 後ろへ落とした位置を、取り除いたあとの番号にする", () => {
    expect(dropIndex(0, 2, false)).toBe(1); // 2 の前へ (自分が抜けるので 1)
    expect(dropIndex(0, 2, true)).toBe(2);  // 2 の後ろへ
    expect(dropIndex(3, 1, false)).toBe(1);
    expect(dropIndex(3, 1, true)).toBe(2);
  });
  it("自分の直前・直後に落としても、動かない", () => {
    expect(dropIndex(2, 2, false)).toBe(2);
    expect(dropIndex(2, 2, true)).toBe(2);
    expect(dropIndex(2, 3, false)).toBe(2);
    expect(dropIndex(2, 1, true)).toBe(2);
  });
});

describe("remapIndex / remapIndexSet", () => {
  it("動かしたあとの番号 (展開・選択の印を持ち越す)", () => {
    // 0 を 2 へ: [a b c d] → [b c a d]
    expect([0, 1, 2, 3].map((i) => remapIndex(i, 0, 2))).toEqual([2, 0, 1, 3]);
    // 3 を 1 へ: [a b c d] → [a d b c]
    expect([0, 1, 2, 3].map((i) => remapIndex(i, 3, 1))).toEqual([0, 2, 3, 1]);
    expect([...remapIndexSet(new Set([0, 3]), 0, 2)].sort()).toEqual([2, 3]);
  });
});
