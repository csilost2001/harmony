/**
 * bootstrapMapper 単体テスト。
 *
 * 各 prop の全プリセット値の出力 class を検証する (テーブル駆動)。
 *
 * #806 子 4
 */

import { describe, it, expect } from "vitest";
import { bootstrapMapper } from "../bootstrap";
import type { LayoutProps } from "../types";

// ---------------------------------------------------------------------------
// 各 prop の全値 (テーブル駆動)
// ---------------------------------------------------------------------------

describe("bootstrapMapper — align", () => {
  it.each([
    ["left", "text-start"],
    ["center", "text-center"],
    ["right", "text-end"],
  ] as const)("align=%s → %s", (align, expected) => {
    expect(bootstrapMapper({ align })).toBe(expected);
  });
});

describe("bootstrapMapper — padding", () => {
  it.each([
    ["none", "p-0"],
    ["sm", "p-2"],
    ["md", "p-3"],
    ["lg", "p-4"],
    ["xl", "p-5"],
  ] as const)("padding=%s → %s", (padding, expected) => {
    expect(bootstrapMapper({ padding })).toBe(expected);
  });
});

describe("bootstrapMapper — paddingX", () => {
  it.each([
    ["none", "px-0"],
    ["sm", "px-2"],
    ["md", "px-3"],
    ["lg", "px-4"],
    ["xl", "px-5"],
  ] as const)("paddingX=%s → %s", (paddingX, expected) => {
    expect(bootstrapMapper({ paddingX })).toBe(expected);
  });
});

describe("bootstrapMapper — paddingY", () => {
  it.each([
    ["none", "py-0"],
    ["sm", "py-2"],
    ["md", "py-3"],
    ["lg", "py-4"],
    ["xl", "py-5"],
  ] as const)("paddingY=%s → %s", (paddingY, expected) => {
    expect(bootstrapMapper({ paddingY })).toBe(expected);
  });
});

describe("bootstrapMapper — margin", () => {
  it.each([
    ["none", "m-0"],
    ["sm", "m-2"],
    ["md", "m-3"],
    ["lg", "m-4"],
    ["xl", "m-5"],
  ] as const)("margin=%s → %s", (margin, expected) => {
    expect(bootstrapMapper({ margin })).toBe(expected);
  });
});

describe("bootstrapMapper — marginBottom", () => {
  it.each([
    ["none", "mb-0"],
    ["sm", "mb-2"],
    ["md", "mb-3"],
    ["lg", "mb-4"],
    ["xl", "mb-5"],
  ] as const)("marginBottom=%s → %s", (marginBottom, expected) => {
    expect(bootstrapMapper({ marginBottom })).toBe(expected);
  });
});

describe("bootstrapMapper — marginTop", () => {
  it.each([
    ["none", "mt-0"],
    ["sm", "mt-2"],
    ["md", "mt-3"],
    ["lg", "mt-4"],
    ["xl", "mt-5"],
  ] as const)("marginTop=%s → %s", (marginTop, expected) => {
    expect(bootstrapMapper({ marginTop })).toBe(expected);
  });
});

describe("bootstrapMapper — gap", () => {
  it.each([
    ["none", "gap-0"],
    ["sm", "gap-2"],
    ["md", "gap-3"],
    ["lg", "gap-4"],
  ] as const)("gap=%s → %s", (gap, expected) => {
    expect(bootstrapMapper({ gap })).toBe(expected);
  });
});

describe("bootstrapMapper — colorAccent", () => {
  it.each([
    ["default", ""],
    ["primary", "text-primary"],
    ["secondary", "text-secondary"],
    ["muted", "text-muted"],
    ["success", "text-success"],
    ["warning", "text-warning"],
    ["danger", "text-danger"],
  ] as const)("colorAccent=%s → '%s'", (colorAccent, expected) => {
    expect(bootstrapMapper({ colorAccent })).toBe(expected);
  });
});

describe("bootstrapMapper — bgAccent", () => {
  it.each([
    ["none", ""],
    ["white", "bg-white"],
    ["muted", "bg-light"],
    ["primary-soft", "bg-primary-subtle"],
    ["success-soft", "bg-success-subtle"],
    ["warning-soft", "bg-warning-subtle"],
    ["danger-soft", "bg-danger-subtle"],
  ] as const)("bgAccent=%s → '%s'", (bgAccent, expected) => {
    expect(bootstrapMapper({ bgAccent })).toBe(expected);
  });
});

describe("bootstrapMapper — border", () => {
  it.each([
    ["none", ""],
    ["default", "border"],
    ["strong", "border border-2"],
  ] as const)("border=%s → '%s'", (border, expected) => {
    expect(bootstrapMapper({ border })).toBe(expected);
  });
});

describe("bootstrapMapper — rounded", () => {
  it.each([
    ["none", "rounded-0"],
    ["sm", "rounded-1"],
    ["md", "rounded-2"],
    ["lg", "rounded-3"],
    ["full", "rounded-pill"],
  ] as const)("rounded=%s → %s", (rounded, expected) => {
    expect(bootstrapMapper({ rounded })).toBe(expected);
  });
});

describe("bootstrapMapper — shadow", () => {
  it.each([
    ["none", ""],
    ["sm", "shadow-sm"],
    ["md", "shadow"],
    ["lg", "shadow-lg"],
  ] as const)("shadow=%s → '%s'", (shadow, expected) => {
    expect(bootstrapMapper({ shadow })).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 複合テスト
// ---------------------------------------------------------------------------

describe("bootstrapMapper — 複数 prop の組み合わせ", () => {
  it("align=right, padding=md, marginBottom=lg", () => {
    const result = bootstrapMapper({ align: "right", padding: "md", marginBottom: "lg" });
    expect(result).toBe("text-end p-3 mb-4");
  });

  it("paddingX=sm, paddingY=lg, gap=md, bgAccent=primary-soft", () => {
    const result = bootstrapMapper({ paddingX: "sm", paddingY: "lg", gap: "md", bgAccent: "primary-soft" });
    expect(result).toBe("px-2 py-4 gap-3 bg-primary-subtle");
  });

  it("border=strong, rounded=full, shadow=lg", () => {
    const result = bootstrapMapper({ border: "strong", rounded: "full", shadow: "lg" });
    expect(result).toBe("border border-2 rounded-pill shadow-lg");
  });

  it("colorAccent=primary, bgAccent=primary-soft", () => {
    const result = bootstrapMapper({ colorAccent: "primary", bgAccent: "primary-soft" });
    expect(result).toBe("text-primary bg-primary-subtle");
  });
});

// ---------------------------------------------------------------------------
// rawClass の append
// ---------------------------------------------------------------------------

describe("bootstrapMapper — rawClass", () => {
  it("rawClass のみ → そのまま返す", () => {
    expect(bootstrapMapper({ rawClass: "custom-class" })).toBe("custom-class");
  });

  it("他 prop + rawClass → 末尾に append", () => {
    const result = bootstrapMapper({ align: "center", rawClass: "extra-class" });
    expect(result).toBe("text-center extra-class");
  });
});

// ---------------------------------------------------------------------------
// 未定義 prop は空文字を含まない
// ---------------------------------------------------------------------------

describe("bootstrapMapper — 未定義 prop の扱い", () => {
  it("空 props → 空文字を返す", () => {
    expect(bootstrapMapper({})).toBe("");
  });

  it("default=none 系の空文字 class は結果に含まれない", () => {
    // colorAccent=default は空文字、bgAccent=none は空文字
    const result = bootstrapMapper({ colorAccent: "default", bgAccent: "none", align: "left" });
    expect(result).toBe("text-start");
  });

  it("すべての空文字系 (shadow=none, border=none, bgAccent=none) → 空文字", () => {
    const props: LayoutProps = { shadow: "none", border: "none", bgAccent: "none" };
    expect(bootstrapMapper(props)).toBe("");
  });
});
