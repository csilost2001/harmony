import { describe, it, expect } from "vitest";
import { extractGrapesHtml, hasLegacyDesignContent } from "./legacyDesign";

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

describe("extractGrapesHtml", () => {
  const design = (components: unknown) => ({ pages: [{ frames: [{ component: { components } }] }] });
  it("pages[0].frames[0].component.components が HTML 文字列ならそれを返す", () => {
    expect(extractGrapesHtml(design("<main><h1>見出し</h1></main>"))).toBe("<main><h1>見出し</h1></main>");
  });
  it("文字列でない (部品 JSON) ・空・壊れたデータは null", () => {
    expect(extractGrapesHtml(design([{ type: "text" }]))).toBeNull();
    expect(extractGrapesHtml(null)).toBeNull();
    expect(extractGrapesHtml({})).toBeNull();
    expect(extractGrapesHtml("x")).toBeNull();
  });
});
