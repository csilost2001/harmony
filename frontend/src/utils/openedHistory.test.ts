import { describe, it, expect, beforeEach } from "vitest";
import { openedAtOf, recordOpened, _resetOpenedForTests } from "./openedHistory";

beforeEach(() => { localStorage.clear(); _resetOpenedForTests(); });

describe("openedHistory (続編 第 6 弾 #111)", () => {
  it("開いた時刻を覚え、開いていないものは 0", () => {
    recordOpened("table:a", 1000);
    recordOpened("table:b", 2000);
    recordOpened("table:a", 3000);
    expect(openedAtOf("table:a")).toBe(3000);
    expect(openedAtOf("table:b")).toBe(2000);
    expect(openedAtOf("table:zzz")).toBe(0);
  });
  it("読み込み直しても残る / 多くなったら古いものから捨てる", () => {
    recordOpened("t:a", 5);
    _resetOpenedForTests();
    expect(openedAtOf("t:a")).toBe(5);
    for (let i = 0; i < 405; i++) recordOpened(`t:${i}`, 100 + i);
    expect(openedAtOf("t:0")).toBe(0);
    expect(openedAtOf("t:404")).toBe(504);
  });
  it("壊れた保存値は空として扱う", () => {
    localStorage.setItem("harmony-opened-at", "[1,2");
    _resetOpenedForTests();
    expect(openedAtOf("x:y")).toBe(0);
  });
});
