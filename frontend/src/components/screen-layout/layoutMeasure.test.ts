import { describe, it, expect } from "vitest";
import { measureSelection } from "./layoutMeasure";

const sel = { x: 20, y: 100, w: 300, h: 60 };
describe("measureSelection (続編 第 8 弾 #143)", () => {
  it("寸法の表示", () => {
    expect(measureSelection(sel, [], null)[0]).toEqual({ kind: "size", x: 20, y: 160, text: "300 × 60" });
  });
  it("縦に並ぶ兄弟とのすき間 (上と下)", () => {
    const r = measureSelection(sel, [{ x: 20, y: 40, w: 300, h: 50 }, { x: 20, y: 172, w: 300, h: 40 }], null);
    const gaps = r.filter((l) => l.kind === "gap") as Array<{ kind: "gap"; box: { x: number; y: number; w: number; h: number }; text: string }>;
    expect(gaps.map((g) => g.text)).toEqual(["10", "12"]);
    expect(gaps[0].box).toEqual({ x: 20, y: 90, w: 300, h: 10 });
    expect(gaps[1].box).toEqual({ x: 20, y: 160, w: 300, h: 12 });
  });
  it("横に並ぶ兄弟とのすき間", () => {
    const r = measureSelection(sel, [{ x: 336, y: 100, w: 100, h: 60 }], null);
    const g = r.find((l) => l.kind === "gap") as { text: string };
    expect(g.text).toBe("16");
  });
  it("重なる・離れすぎて並んでいない兄弟は出さない", () => {
    expect(measureSelection(sel, [{ x: 100, y: 120, w: 50, h: 20 }, { x: 900, y: 900, w: 10, h: 10 }], null).filter((l) => l.kind === "gap")).toHaveLength(0);
  });
  it("入れ物の内側の余白 (上下左右)。0 のところは出さない", () => {
    const r = measureSelection(sel, [], { x: 0, y: 80, w: 340, h: 100 });
    expect(r.filter((l) => l.kind === "gap").map((l) => (l as { text: string }).text).sort()).toEqual(["20", "20", "20", "20"]);
  });
});
