import { describe, it, expect, vi } from "vitest";
import { registerPageCommands, getPageCommands, onPageCommandsChange, type PageCommand } from "./pageCommands";

const cmd = (id: string): PageCommand => ({ id, label: id, keywords: [], icon: "bi-x", run: () => undefined });

describe("pageCommands", () => {
  it("登録した順に返し、解除すると消える。変化を知らせる", () => {
    const changed = vi.fn();
    const off = onPageCommandsChange(changed);
    const a = () => [cmd("a1"), cmd("a2")];
    const b = () => [cmd("b1")];
    const offA = registerPageCommands("A", a);
    const offB = registerPageCommands("B", b);
    expect(getPageCommands().map((c) => c.id)).toEqual(["a1", "a2", "b1"]);
    offA();
    expect(getPageCommands().map((c) => c.id)).toEqual(["b1"]);
    offB();
    expect(getPageCommands()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(4);
    off();
  });

  it("同じ名前で登録し直すと置き換わる。古い解除は、新しい登録を消さない", () => {
    const first = () => [cmd("x")];
    const second = () => [cmd("y")];
    const offFirst = registerPageCommands("S", first);
    const offSecond = registerPageCommands("S", second);
    offFirst();
    expect(getPageCommands().map((c) => c.id)).toEqual(["y"]);
    offSecond();
  });

  it("実行のたびに、いちばん新しい操作の一覧を読む (呼び出し側が毎回 get で最新を返せる)", () => {
    let n = 1;
    const off = registerPageCommands("D", () => [cmd(`c${n}`)]);
    expect(getPageCommands()[0].id).toBe("c1");
    n = 2;
    expect(getPageCommands()[0].id).toBe("c2");
    off();
  });
});
