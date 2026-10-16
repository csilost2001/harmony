import { describe, it, expect } from "vitest";
import { buildPrintDocument, paddedBounds } from "./diagramExport";

describe("diagramExport (続編 第 7 弾 #128 #135)", () => {
  it("範囲に余白を足す。大きさは 1 以上の整数", () => {
    expect(paddedBounds({ x: 10, y: 20, width: 100.2, height: 50 }, 10)).toEqual({ x: 0, y: 10, width: 121, height: 70 });
    expect(paddedBounds({ x: 0, y: 0, width: 0, height: 0 }, 0).width).toBe(1);
  });
  it("印刷用の文書: 用紙・向き・見出し・日付が入る。文字はエスケープする", () => {
    const html = buildPrintDocument({ title: "ER 図 <a>", imageUrl: "data:image/png;base64,AAA", paper: "A3", orientation: "landscape", date: "2026-10-16" });
    expect(html).toContain("size: A3 landscape");
    expect(html).toContain("2026-10-16");
    expect(html).toContain("ER 図 &lt;a&gt;");
    expect(html).not.toContain("<a>");
    expect(html).toContain('src="data:image/png;base64,AAA"');
  });
});
