/**
 * buildConfig.ts の単体テスト。
 *
 * 各 primitive が共通レイアウト fields を持つこと、
 * Puck Config として valid な構造を持つことを検証する。
 *
 * #806 子 4
 */

import { describe, it, expect } from "vitest";
import {
  buildPuckConfig,
  buildConfigWithCustomComponents,
  BUILTIN_PRIMITIVE_NAMES,
} from "../buildConfig";
import { LAYOUT_FIELDS } from "../buildConfig";
import type { CustomPuckComponentDef } from "../../store/puckComponentsStore";

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

describe("buildPuckConfig categories (#1410 P-2)", () => {
  const config = buildPuckConfig();

  it("categories が定義され 6 カテゴリ (layout/text/form/data/composite/regions) を持つ", () => {
    expect(config.categories).toBeDefined();
    const cats = config.categories!;
    for (const key of ["layout", "text", "form", "data", "composite", "regions"]) {
      expect(cats).toHaveProperty(key);
    }
  });

  it("各カテゴリに日本語 title が付く", () => {
    const cats = config.categories!;
    expect(cats.layout!.title).toBe("レイアウト");
    expect(cats.text!.title).toBe("テキスト");
    expect(cats.form!.title).toBe("フォーム");
    expect(cats.data!.title).toBe("データ");
    expect(cats.composite!.title).toBe("業務複合");
    expect(cats.regions!.title).toBe("レイアウト領域");
  });

  it("全ビルトイン component がいずれかのカテゴリに割り当てられている (other に落ちない)", () => {
    const assigned = new Set<string>();
    for (const cat of Object.values(config.categories!)) {
      for (const c of cat?.components ?? []) {
        assigned.add(c as string);
      }
    }
    for (const key of Object.keys(config.components)) {
      expect(assigned.has(key)).toBe(true);
    }
  });
});

describe("buildConfigWithCustomComponents categories + fields (#1410 P-2)", () => {
  const customDef: CustomPuckComponentDef = {
    id: "my-widget",
    label: "マイウィジェット",
    primitive: "container",
    propsSchema: {
      title: { type: "string", label: "タイトル" },
      count: { type: "number", label: "件数" },
      enabled: { type: "boolean", label: "有効" },
      mode: {
        type: "enum",
        label: "モード",
        enum: [
          { label: "標準", value: "normal" },
          { label: "高速", value: "fast" },
        ],
      },
    },
  };

  it("custom 0 件なら projectCustom カテゴリは無い", () => {
    const config = buildConfigWithCustomComponents([]);
    expect(config.categories?.projectCustom).toBeUndefined();
    // base の 6 カテゴリは保持
    expect(config.categories?.layout).toBeDefined();
  });

  it("custom を渡すと projectCustom カテゴリができ components に custom id が入る", () => {
    const config = buildConfigWithCustomComponents([customDef]);
    expect(config.categories?.projectCustom).toBeDefined();
    expect(config.categories!.projectCustom!.title).toBe("プロジェクト部品 (カスタム)");
    expect(config.categories!.projectCustom!.components).toContain("my-widget");
    // base カテゴリは不変
    expect(config.categories?.layout?.components).toContain("Container");
  });

  it("custom の各 prop 型が正しい Puck field 型に変換される", () => {
    const config = buildConfigWithCustomComponents([customDef]);
    const fields = config.components["my-widget"].fields!;

    expect(fields.title.type).toBe("text");
    expect(fields.count.type).toBe("number");
    expect(fields.enabled.type).toBe("radio");
    expect(fields.mode.type).toBe("select");
  });

  it("boolean は はい/いいえ の radio options (string value)", () => {
    const config = buildConfigWithCustomComponents([customDef]);
    const f = config.components["my-widget"].fields!.enabled as {
      type: string;
      options: { label: string; value: string }[];
    };
    expect(f.type).toBe("radio");
    expect(f.options).toEqual([
      { label: "はい", value: "true" },
      { label: "いいえ", value: "false" },
    ]);
  });

  it("enum は options を反映した select", () => {
    const config = buildConfigWithCustomComponents([customDef]);
    const f = config.components["my-widget"].fields!.mode as {
      type: string;
      options: { label: string; value: string }[];
    };
    expect(f.type).toBe("select");
    expect(f.options).toEqual([
      { label: "標準", value: "normal" },
      { label: "高速", value: "fast" },
    ]);
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
