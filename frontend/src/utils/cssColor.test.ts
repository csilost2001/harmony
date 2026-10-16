import { describe, it, expect } from "vitest";
import { hasColorFunction, replaceColorFunctions, srgbArgsToRgba } from "./cssColor";

describe("cssColor (続編 第 7 弾: 画像の書き出しの修正)", () => {
  it("color(srgb ...) を rgba にする", () => {
    expect(replaceColorFunctions("color(srgb 0.2 0.4 0.6)")).toBe("rgba(51, 102, 153, 1)");
    expect(replaceColorFunctions("color(srgb 1 0 0 / 0.5)")).toBe("rgba(255, 0, 0, 0.5)");
    expect(replaceColorFunctions("color(srgb 100% 50% 0% / 25%)")).toBe("rgba(255, 128, 0, 0.25)");
  });
  it("文字列の中に複数あっても (影・グラデーション)、すべて置き換える", () => {
    expect(replaceColorFunctions("0px 4px 8px color(srgb 0 0 0 / 0.2), 0 0 2px color(srgb 1 1 1)")).toBe("0px 4px 8px rgba(0, 0, 0, 0.2), 0 0 2px rgba(255, 255, 255, 1)");
  });
  it("ほかの書き方・読めないものは、そのまま", () => {
    expect(replaceColorFunctions("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(replaceColorFunctions("color(display-p3 1 0 0)")).toBe("color(display-p3 1 0 0)");
    expect(srgbArgsToRgba("a b c")).toBeNull();
    expect(srgbArgsToRgba("1 2")).toBeNull();
  });
  it("範囲外は丸める", () => { expect(srgbArgsToRgba("2 -1 0.5 / 3")).toBe("rgba(255, 0, 128, 1)"); });
  it("含むかどうか", () => {
    expect(hasColorFunction("a color(srgb 0 0 0) b")).toBe(true);
    expect(hasColorFunction("a color(srgb 0 0 0) b")).toBe(true); // 続けて呼んでも同じ
    expect(hasColorFunction("rgb(0,0,0)")).toBe(false);
  });
});
