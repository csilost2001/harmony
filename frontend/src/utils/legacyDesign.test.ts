import { describe, it, expect } from "vitest";
import { hasLegacyDesignContent } from "./legacyDesign";

describe("hasLegacyDesignContent", () => {
  const proj = (components: unknown) => ({ pages: [{ frames: [{ component: { type: "wrapper", components } }] }] });
  it("中身の無い (新規作成直後の) デザインは旧形式としない", () => {
    expect(hasLegacyDesignContent(null)).toBe(false);
    expect(hasLegacyDesignContent(proj(""))).toBe(false);
    expect(hasLegacyDesignContent(proj([]))).toBe(false);
    expect(hasLegacyDesignContent({ pages: [] })).toBe(false);
  });
  it("HTML・部品 JSON・外部 HTML 参照があれば旧形式", () => {
    expect(hasLegacyDesignContent(proj("<main>x</main>"))).toBe(true);
    expect(hasLegacyDesignContent(proj([{ tagName: "div" }]))).toBe(true);
    expect(hasLegacyDesignContent({ pages: [{ frames: [{ component: { componentsRef: "a.components.html" } }] }] })).toBe(true);
  });
  it("形式が壊れたデータは旧デザイナで扱う", () => {
    expect(hasLegacyDesignContent({ pages: "broken" })).toBe(true);
    expect(hasLegacyDesignContent("garbage")).toBe(true);
    expect(hasLegacyDesignContent({})).toBe(true);
  });
});
