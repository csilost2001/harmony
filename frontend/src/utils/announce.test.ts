import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ANNOUNCE_DELAY_MS, _resetAnnouncer, announce, subscribeAnnouncements } from "./announce";

beforeEach(() => { vi.useFakeTimers(); _resetAnnouncer(); });
afterEach(() => { vi.useRealTimers(); });

describe("announce (続編 第 10 弾 #187)", () => {
  it("短い間の知らせは、まとめて 1 回で出す (続けて同じ文は 1 つ)", () => {
    const got: string[] = [];
    const off = subscribeAnnouncements((t) => got.push(t));
    announce("注文のタブに移りました");
    announce("注文のタブに移りました");
    announce("絞り込み: 12 件");
    expect(got).toEqual([]);
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS + 1);
    expect(got).toEqual(["注文のタブに移りました。絞り込み: 12 件"]);
    off();
  });
  it("新しい 3 件までをまとめる。空の文は無視する", () => {
    const got: string[] = [];
    const off = subscribeAnnouncements((t) => got.push(t));
    ["a", "b", "c", "d", " "].forEach(announce);
    vi.advanceTimersByTime(ANNOUNCE_DELAY_MS + 1);
    expect(got).toEqual(["b。c。d"]);
    off();
  });
  it("間が空けば、別々に出す。解除したあとは届かない", () => {
    const got: string[] = [];
    const off = subscribeAnnouncements((t) => got.push(t));
    announce("1"); vi.advanceTimersByTime(ANNOUNCE_DELAY_MS + 1);
    announce("2"); vi.advanceTimersByTime(ANNOUNCE_DELAY_MS + 1);
    off();
    announce("3"); vi.advanceTimersByTime(ANNOUNCE_DELAY_MS + 1);
    expect(got).toEqual(["1", "2"]);
  });
});
