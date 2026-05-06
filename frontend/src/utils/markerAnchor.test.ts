import { describe, it, expect } from "vitest";
import {
  parsePathPoints,
  computeBBox,
  convertPathToAnchorRelative,
  strokesCenterInViewport,
} from "./markerAnchor";

describe("parsePathPoints", () => {
  it("M / L の座標を全て抽出", () => {
    const d = "M 10 20 L 30 40 L 50 60";
    expect(parsePathPoints(d)).toEqual([
      { x: 10, y: 20 }, { x: 30, y: 40 }, { x: 50, y: 60 },
    ]);
  });
  it("複数 M (マルチストローク合体) も対応", () => {
    const d = "M 1 2 L 3 4 M 5 6 L 7 8";
    expect(parsePathPoints(d)).toHaveLength(4);
  });
  it("小数点を含む座標を抽出", () => {
    expect(parsePathPoints("M 12.34 56.78")).toEqual([{ x: 12.34, y: 56.78 }]);
  });
  it("空文字 / コマンドなしは空配列", () => {
    expect(parsePathPoints("")).toEqual([]);
    expect(parsePathPoints("Z")).toEqual([]);
  });
});

describe("computeBBox", () => {
  it("点群の min/max/center を返す", () => {
    const bb = computeBBox([{ x: 0, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }]);
    expect(bb).toEqual({
      min: { x: 0, y: 0 },
      max: { x: 100, y: 100 },
      center: { x: 50, y: 50 },
    });
  });
  it("1 点なら min=max=center", () => {
    const bb = computeBBox([{ x: 42, y: 42 }]);
    expect(bb?.center).toEqual({ x: 42, y: 42 });
  });
  it("空配列は null", () => {
    expect(computeBBox([])).toBeNull();
  });
});

describe("convertPathToAnchorRelative", () => {
  it("overlay が全画面、anchor が中央 50% の場合 (コーナー)", () => {
    // overlay: viewport 全体 (0,0) 1000x1000
    // anchor:  viewport 中央 (250, 250) 500x500 = 25-75% of viewport
    // overlay 座標 (50, 50) = viewport 中央 (500, 500) = anchor 中央 (50%, 50%)
    const out = convertPathToAnchorRelative(
      "M 50 50",
      { left: 0, top: 0, width: 1000, height: 1000 },
      { left: 250, top: 250, width: 500, height: 500 },
    );
    expect(out).toBe("M 50.00 50.00");
  });

  it("overlay 左上 (0,0) は anchor 基準で負値", () => {
    // anchor が (250, 250) から始まる → overlay の (0,0) は anchor の (-50%, -50%)
    const out = convertPathToAnchorRelative(
      "M 0 0",
      { left: 0, top: 0, width: 1000, height: 1000 },
      { left: 250, top: 250, width: 500, height: 500 },
    );
    expect(out).toBe("M -50.00 -50.00");
  });

  it("複数コマンドを全部変換", () => {
    const out = convertPathToAnchorRelative(
      "M 25 25 L 75 75",
      { left: 0, top: 0, width: 1000, height: 1000 },
      { left: 250, top: 250, width: 500, height: 500 },
    );
    // (25,25) in overlay = vp (250,250) = anchor (0%, 0%)
    // (75,75) in overlay = vp (750,750) = anchor (100%, 100%)
    expect(out).toBe("M 0.00 0.00 L 100.00 100.00");
  });

  it("anchor width=0 はそのまま返す (zero divide 回避)", () => {
    const out = convertPathToAnchorRelative(
      "M 50 50",
      { left: 0, top: 0, width: 1000, height: 1000 },
      { left: 0, top: 0, width: 0, height: 100 },
    );
    expect(out).toBe("M 50 50");
  });
});

describe("strokesCenterInViewport", () => {
  it("全ストロークの中点を viewport px で返す", () => {
    const strokes = ["M 0 0 L 100 0", "M 0 100 L 100 100"];
    const center = strokesCenterInViewport(strokes, {
      left: 200, top: 300, width: 400, height: 500,
    });
    // bbox center in overlay % = (50, 50)
    // = viewport (200 + 0.5*400, 300 + 0.5*500) = (400, 550)
    expect(center).toEqual({ x: 400, y: 550 });
  });
  it("空のストロークは null", () => {
    expect(strokesCenterInViewport([], { left: 0, top: 0, width: 100, height: 100 })).toBeNull();
    expect(strokesCenterInViewport([""], { left: 0, top: 0, width: 100, height: 100 })).toBeNull();
  });
});
