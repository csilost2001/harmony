/**
 * buildConfig.ts の単体テスト。
 *
 * 各 primitive が共通レイアウト fields を持つこと、
 * Puck Config として valid な構造を持つことを検証する。
 *
 * #806 子 4
 */

import { describe, it, expect } from "vitest";
import { buildPuckConfig, BUILTIN_PRIMITIVE_NAMES } from "../buildConfig";
import { LAYOUT_FIELDS } from "../buildConfig";

const LAYOUT_FIELD_KEYS = Object.keys(LAYOUT_FIELDS);

describe("buildPuckConfig", () => {
  const config = buildPuckConfig();

  it("components が object である", () => {
    expect(config.components).toBeDefined();
    expect(typeof config.components).toBe("object");
  });

  it("23-26 個のコンポーネントを含む (Region primitives 4 つを含む)", () => {
    const count = Object.keys(config.components).length;
    expect(count).toBeGreaterThanOrEqual(23);
    expect(count).toBeLessThanOrEqual(26);
  });

  it.each([
    "Container", "Row", "Col", "Section",
    "Heading", "Paragraph", "Link",
    "Input", "Select", "Textarea", "Checkbox", "Radio", "Button",
    "Table", "Image", "Icon",
    "InputGroup", "Card", "DataList", "Pagination",
    // pl-5 follow-up: Region primitives
    "RegionHeader", "RegionSidebar", "RegionFooter", "RegionMain",
  ])("%s コンポーネントが存在する", (name) => {
    expect(config.components).toHaveProperty(name);
  });

  it.each([
    "Container", "Row", "Col", "Section",
    "Heading", "Paragraph", "Link",
    "Input", "Select", "Textarea", "Checkbox", "Radio", "Button",
    "Table", "Image", "Icon",
    "InputGroup", "Card", "DataList", "Pagination",
    // pl-5 follow-up: Region primitives
    "RegionHeader", "RegionSidebar", "RegionFooter", "RegionMain",
  ])("%s が共通レイアウト fields をすべて持つ", (name) => {
    const comp = config.components[name as keyof typeof config.components];
    expect(comp).toBeDefined();
    if (!comp) return;
    const fields = comp.fields ?? {};
    for (const key of LAYOUT_FIELD_KEYS) {
      expect(fields).toHaveProperty(key);
    }
  });

  it.each([
    "Container", "Row", "Col", "Section",
    "Heading", "Paragraph", "Link",
    "Input", "Select", "Textarea", "Checkbox", "Radio", "Button",
    "Table", "Image", "Icon",
    "InputGroup", "Card", "DataList", "Pagination",
    // pl-5 follow-up: Region primitives
    "RegionHeader", "RegionSidebar", "RegionFooter", "RegionMain",
  ])("%s が render 関数を持つ", (name) => {
    const comp = config.components[name as keyof typeof config.components];
    expect(comp).toBeDefined();
    if (!comp) return;
    expect(typeof comp.render).toBe("function");
  });

  it.each([
    "Container", "Row", "Col", "Section",
    "Heading", "Paragraph", "Link",
    "Input", "Select", "Textarea", "Checkbox", "Radio", "Button",
    "Table", "Image", "Icon",
    "InputGroup", "Card", "DataList", "Pagination",
    // pl-5 follow-up: Region primitives
    "RegionHeader", "RegionSidebar", "RegionFooter", "RegionMain",
  ])("%s が defaultProps を持つ", (name) => {
    const comp = config.components[name as keyof typeof config.components];
    expect(comp).toBeDefined();
    if (!comp) return;
    expect(comp.defaultProps).toBeDefined();
  });

  it.each(["RegionHeader", "RegionSidebar", "RegionFooter", "RegionMain"])(
    "%s が Layout Regions カテゴリ相当の label を持つ",
    (name) => {
      const comp = config.components[name as keyof typeof config.components];
      expect(comp).toBeDefined();
      if (!comp) return;
      expect(comp.label).toBeDefined();
      expect(typeof comp.label).toBe("string");
    },
  );
});

describe("LAYOUT_FIELDS", () => {
  it("全 13 の共通レイアウト prop が定義されている", () => {
    const expectedKeys = [
      "align", "padding", "paddingX", "paddingY",
      "margin", "marginBottom", "marginTop",
      "gap", "colorAccent", "bgAccent",
      "border", "rounded", "shadow", "rawClass",
    ];
    for (const key of expectedKeys) {
      expect(LAYOUT_FIELDS).toHaveProperty(key);
    }
  });

  it("align は select 型", () => {
    expect(LAYOUT_FIELDS.align.type).toBe("select");
  });

  it("rawClass は text 型", () => {
    expect(LAYOUT_FIELDS.rawClass.type).toBe("text");
  });
});

describe("BUILTIN_PRIMITIVE_NAMES", () => {
  it("23-26 個のプリミティブ名を含む (Region primitives 4 つを含む)", () => {
    expect(BUILTIN_PRIMITIVE_NAMES.length).toBeGreaterThanOrEqual(23);
    expect(BUILTIN_PRIMITIVE_NAMES.length).toBeLessThanOrEqual(26);
  });

  it("input-group を含む", () => {
    expect(BUILTIN_PRIMITIVE_NAMES).toContain("input-group");
  });

  it("data-list を含む", () => {
    expect(BUILTIN_PRIMITIVE_NAMES).toContain("data-list");
  });

  it("region-header を含む", () => {
    expect(BUILTIN_PRIMITIVE_NAMES).toContain("region-header");
  });

  it("region-sidebar を含む", () => {
    expect(BUILTIN_PRIMITIVE_NAMES).toContain("region-sidebar");
  });

  it("region-footer を含む", () => {
    expect(BUILTIN_PRIMITIVE_NAMES).toContain("region-footer");
  });

  it("region-main を含む", () => {
    expect(BUILTIN_PRIMITIVE_NAMES).toContain("region-main");
  });
});
