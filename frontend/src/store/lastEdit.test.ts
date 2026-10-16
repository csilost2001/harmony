import { describe, it, expect, beforeEach } from "vitest";
import { clearEditSpots, getEditSpots, nextEditSpot, recordEdit } from "./lastEdit";

beforeEach(() => clearEditSpots());

describe("lastEdit (続編 第 8 弾 #158)", () => {
  it("入力した場所を新しい順に覚え、同じ場所の続きは時刻だけ更新する", () => {
    recordEdit("t1", "step:a", 1);
    recordEdit("t1", "step:a", 2);
    recordEdit("t2", "column:x", 3);
    expect(getEditSpots().map((s) => `${s.tabId}/${s.key}`)).toEqual(["t2/column:x", "t1/step:a"]);
    expect(getEditSpots()[1].at).toBe(2);
  });
  it("前に入力した場所に戻ってまた入力すると、先頭へ移る (重複しない)", () => {
    recordEdit("t1", "step:a", 1); recordEdit("t1", "step:b", 2); recordEdit("t1", "step:a", 3);
    expect(getEditSpots().map((s) => s.key)).toEqual(["step:a", "step:b"]);
  });
  it("戻る: 最初は直前の場所。短い間に続けると、さらに前、一周して最初へ", () => {
    recordEdit("t1", "step:a", 1); recordEdit("t1", "step:b", 2); recordEdit("t1", "step:c", 3);
    expect(nextEditSpot(10_000)?.key).toBe("step:c");
    expect(nextEditSpot(10_500)?.key).toBe("step:b");
    expect(nextEditSpot(11_000)?.key).toBe("step:a");
    expect(nextEditSpot(11_500)?.key).toBe("step:c");
  });
  it("間があいたら、また直前の場所から / 場所が無ければ null / 上限は 12 件", () => {
    expect(nextEditSpot(1)).toBeNull();
    recordEdit("t", "k1", 1); recordEdit("t", "k2", 2);
    expect(nextEditSpot(100_000)?.key).toBe("k2");
    expect(nextEditSpot(100_500)?.key).toBe("k1");
    expect(nextEditSpot(200_000)?.key).toBe("k2");
    for (let i = 0; i < 20; i++) recordEdit("t", `n${i}`, 300 + i);
    expect(getEditSpots()).toHaveLength(12);
  });
  it("空の入力は覚えない", () => { recordEdit("", "k", 1); recordEdit("t", "", 1); expect(getEditSpots()).toHaveLength(0); });
});
