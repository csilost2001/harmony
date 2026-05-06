/**
 * tailwindMapper 単体テスト。
 *
 * 各 prop の全プリセット値の出力 class を検証する (テーブル駆動)。
 *
 * #806 子 4
 */

import { describe, it, expect } from "vitest";
import { tailwindMapper } from "../tailwind";
import type { LayoutProps } from "../types";

// ---------------------------------------------------------------------------
// 各 prop の全値 (テーブル駆動)
// ---------------------------------------------------------------------------

describe("tailwindMapper — align", () => {
  it.each([
    ["left", "text-left"],
    ["center", "text-center"],
    ["right", "text-right"],
  ] as const)("align=%s → %s", (align, expected) => {
    expect(tailwindMapper({ align })).toBe(expected);
  });
});

describe("tailwindMapper — padding", () => {
  it.each([
    ["none", "p-0"],
    ["sm", "p-2"],
    ["md", "p-4"],
    ["lg", "p-6"],
    ["xl", "p-8"],
  ] as const)("padding=%s → %s", (padding, expected) => {
    expect(tailwindMapper({ padding })).toBe(expected);
  });
});

describe("tailwindMapper — paddingX", () => {
  it.each([
    ["none", "px-0"],
    ["sm", "px-2"],
    ["md", "px-4"],
    ["lg", "px-6"],
    ["xl", "px-8"],
  ] as const)("paddingX=%s → %s", (paddingX, expected) => {
    expect(tailwindMapper({ paddingX })).toBe(expected);
  });
});

describe("tailwindMapper — paddingY", () => {
  it.each([
    ["none", "py-0"],
    ["sm", "py-2"],
    ["md", "py-4"],
    ["lg", "py-6"],
    ["xl", "py-8"],
  ] as const)("paddingY=%s → %s", (paddingY, expected) => {
    expect(tailwindMapper({ paddingY })).toBe(expected);
  });
});

describe("tailwindMapper — margin", () => {
  it.each([
    ["none", "m-0"],
    ["sm", "m-2"],
    ["md", "m-4"],
    ["lg", "m-6"],
    ["xl", "m-8"],
  ] as const)("margin=%s → %s", (margin, expected) => {
    expect(tailwindMapper({ margin })).toBe(expected);
  });
});

describe("tailwindMapper — marginBottom", () => {
  it.each([
    ["none", "mb-0"],
    ["sm", "mb-2"],
    ["md", "mb-4"],
    ["lg", "mb-6"],
    ["xl", "mb-8"],
  ] as const)("marginBottom=%s → %s", (marginBottom, expected) => {
    expect(tailwindMapper({ marginBottom })).toBe(expected);
  });
});

describe("tailwindMapper — marginTop", () => {
  it.each([
    ["none", "mt-0"],
    ["sm", "mt-2"],
    ["md", "mt-4"],
    ["lg", "mt-6"],
    ["xl", "mt-8"],
  ] as const)("marginTop=%s → %s", (marginTop, expected) => {
    expect(tailwindMapper({ marginTop })).toBe(expected);
  });
});

describe("tailwindMapper — gap", () => {
  it.each([
    ["none", "gap-0"],
    ["sm", "gap-2"],
    ["md", "gap-4"],
    ["lg", "gap-6"],
  ] as const)("gap=%s → %s", (gap, expected) => {
    expect(tailwindMapper({ gap })).toBe(expected);
  });
});

describe("tailwindMapper — colorAccent", () => {
  it.each([
    ["default", "text-gray-900"],
    ["primary", "text-blue-600"],
    ["secondary", "text-purple-600"],
    ["muted", "text-gray-500"],
    ["success", "text-green-600"],
    ["warning", "text-yellow-600"],
    ["danger", "text-red-600"],
  ] as const)("colorAccent=%s → %s", (colorAccent, expected) => {
    expect(tailwindMapper({ colorAccent })).toBe(expected);
  });
});

describe("tailwindMapper — bgAccent", () => {
  it.each([
    ["none", ""],
    ["white", "bg-white"],
    ["muted", "bg-gray-50"],
    ["primary-soft", "bg-blue-50"],
    ["success-soft", "bg-green-50"],
    ["warning-soft", "bg-yellow-50"],
    ["danger-soft", "bg-red-50"],
  ] as const)("bgAccent=%s → '%s'", (bgAccent, expected) => {
    const result = tailwindMapper({ bgAccent });
    expect(result).toBe(expected);
  });
});

describe("tailwindMapper — border", () => {
  it.each([
    ["none", ""],
    ["default", "border"],
    ["strong", "border-2"],
  ] as const)("border=%s → '%s'", (border, expected) => {
    expect(tailwindMapper({ border })).toBe(expected);
  });
});

describe("tailwindMapper — rounded", () => {
  it.each([
    ["none", "rounded-none"],
    ["sm", "rounded-sm"],
    ["md", "rounded-md"],
    ["lg", "rounded-lg"],
    ["full", "rounded-full"],
  ] as const)("rounded=%s → %s", (rounded, expected) => {
    expect(tailwindMapper({ rounded })).toBe(expected);
  });
});

describe("tailwindMapper — shadow", () => {
  it.each([
    ["none", ""],
    ["sm", "shadow-sm"],
    ["md", "shadow-md"],
    ["lg", "shadow-lg"],
  ] as const)("shadow=%s → '%s'", (shadow, expected) => {
    expect(tailwindMapper({ shadow })).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// 複合テスト
// ---------------------------------------------------------------------------

describe("tailwindMapper — 複数 prop の組み合わせ", () => {
  it("align=right, padding=md, marginBottom=lg", () => {
    const result = tailwindMapper({ align: "right", padding: "md", marginBottom: "lg" });
    expect(result).toBe("text-right p-4 mb-6");
  });

  it("paddingX=sm, paddingY=lg, gap=md, bgAccent=primary-soft", () => {
    const result = tailwindMapper({ paddingX: "sm", paddingY: "lg", gap: "md", bgAccent: "primary-soft" });
    expect(result).toBe("px-2 py-6 gap-4 bg-blue-50");
  });

  it("border=default, rounded=md, shadow=sm", () => {
    const result = tailwindMapper({ border: "default", rounded: "md", shadow: "sm" });
    expect(result).toBe("border rounded-md shadow-sm");
  });

  it("colorAccent=success, bgAccent=success-soft", () => {
    const result = tailwindMapper({ colorAccent: "success", bgAccent: "success-soft" });
    expect(result).toBe("text-green-600 bg-green-50");
  });
});

// ---------------------------------------------------------------------------
// rawClass の append
// ---------------------------------------------------------------------------

describe("tailwindMapper — rawClass", () => {
  it("rawClass のみ → そのまま返す", () => {
    expect(tailwindMapper({ rawClass: "custom-class" })).toBe("custom-class");
  });

  it("他 prop + rawClass → 末尾に append", () => {
    const result = tailwindMapper({ align: "center", rawClass: "extra-class" });
    expect(result).toBe("text-center extra-class");
  });
});

// ---------------------------------------------------------------------------
// 未定義 prop は空文字を含まない
// ---------------------------------------------------------------------------

describe("tailwindMapper — 未定義 prop の扱い", () => {
  it("空 props → 空文字を返す", () => {
    expect(tailwindMapper({})).toBe("");
  });

  it("none 系の空文字 class は結果に含まれない", () => {
    // bgAccent=none は空文字、border=none は空文字 → join 後に空文字トークンが混入しない
    const result = tailwindMapper({ bgAccent: "none", border: "none", align: "left" });
    expect(result).toBe("text-left");
  });

  it("すべての空文字系 (shadow=none, border=none, bgAccent=none) → 空文字", () => {
    const props: LayoutProps = { shadow: "none", border: "none", bgAccent: "none" };
    expect(tailwindMapper(props)).toBe("");
  });
});
