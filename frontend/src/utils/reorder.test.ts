import { describe, expect, it } from "vitest";
import { moveById, moveByIdAt } from "./reorder";

const ids = (l: { id: string }[]) => l.map((x) => x.id).join("");
const mk = () => ["a", "b", "c", "d"].map((id) => ({ id }));

describe("moveById", () => {
  it("後ろへ動かすと、その位置に入る", () => {
    const l = mk();
    expect(moveById(l, "a", "c")).toBe(true);
    expect(ids(l)).toBe("bcad");
  });
  it("前へ動かすと、その位置に入る", () => {
    const l = mk();
    expect(moveById(l, "d", "b")).toBe(true);
    expect(ids(l)).toBe("adbc");
  });
  it("同じ位置・存在しない id は何もしない", () => {
    const l = mk();
    expect(moveById(l, "b", "b")).toBe(false);
    expect(moveById(l, "x", "b")).toBe(false);
    expect(moveById(l, "b", "x")).toBe(false);
    expect(ids(l)).toBe("abcd");
  });
});

describe("moveByIdAt", () => {
  // [動かす, 相手, 位置, 結果]。ABCD から動かす
  const cases: Array<[string, string, "before" | "after", string]> = [
    ["A", "B", "before", "ABCD"], // すでにその位置 → 動かない
    ["A", "B", "after", "BACD"],
    ["A", "C", "before", "BACD"],
    ["A", "D", "after", "BCDA"],
    ["C", "B", "before", "ACBD"],
    ["C", "B", "after", "ABCD"], // すでにその位置 → 動かない
    ["D", "A", "before", "DABC"],
  ];
  it.each(cases)("%s を %s の %s へ → %s", (active, over, place, expected) => {
    const l = mk();
    moveByIdAt(l, active.toLowerCase(), over.toLowerCase(), place);
    expect(ids(l)).toBe(expected.toLowerCase());
  });
  it("動かなかったときは false、動いたときは true", () => {
    expect(moveByIdAt(mk(), "a", "b", "before")).toBe(false);
    expect(moveByIdAt(mk(), "a", "b", "after")).toBe(true);
    expect(moveByIdAt(mk(), "a", "a", "after")).toBe(false);
    expect(moveByIdAt(mk(), "x", "b", "after")).toBe(false);
    expect(moveByIdAt(mk(), "a", "x", "after")).toBe(false);
  });
});
