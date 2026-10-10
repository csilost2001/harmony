import { describe, expect, it } from "vitest";
import { moveById } from "./reorder";

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
