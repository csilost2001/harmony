import { describe, it, expect } from "vitest";
import { isValidUuid, isValidEntityId } from "./entityIdValidation";

describe("isValidUuid", () => {
  it("RFC 4122 v4 形式の UUID を accept する", () => {
    expect(isValidUuid("12345678-1234-4abc-89ab-1234567890ab")).toBe(true);
    expect(isValidUuid("00000000-0000-4000-8000-000000000000")).toBe(true);
    expect(isValidUuid("ffffffff-ffff-4fff-bfff-ffffffffffff")).toBe(true);
  });

  it("大文字も accept する (case-insensitive)", () => {
    expect(isValidUuid("12345678-1234-4ABC-89AB-1234567890AB")).toBe(true);
  });

  it("v4 以外の UUID 形式は reject する", () => {
    // version 3 (13 桁目が 3)
    expect(isValidUuid("12345678-1234-3abc-89ab-1234567890ab")).toBe(false);
    // variant 不正 (17 桁目が c)
    expect(isValidUuid("12345678-1234-4abc-c9ab-1234567890ab")).toBe(false);
  });

  it("kebab-case 英単語は reject する", () => {
    expect(isValidUuid("user-form")).toBe(false);
    expect(isValidUuid("shopping-cart")).toBe(false);
  });

  it("空文字 / null / undefined / 非文字列は reject する", () => {
    expect(isValidUuid("")).toBe(false);
    expect(isValidUuid(null)).toBe(false);
    expect(isValidUuid(undefined)).toBe(false);
    expect(isValidUuid(123)).toBe(false);
    expect(isValidUuid({})).toBe(false);
  });

  it("hyphen 位置がずれた文字列は reject する", () => {
    expect(isValidUuid("123456781234-4abc-89ab-1234567890ab")).toBe(false);
    expect(isValidUuid("12345678-1234-4abc89ab-1234567890ab")).toBe(false);
  });
});

describe("isValidEntityId", () => {
  it("kebab-case 英単語を accept する", () => {
    expect(isValidEntityId("user-form")).toBe(true);
    expect(isValidEntityId("shopping-cart")).toBe(true);
    expect(isValidEntityId("a")).toBe(true);
    expect(isValidEntityId("order-line-item")).toBe(true);
  });

  it("数字を含む kebab-case を accept する", () => {
    expect(isValidEntityId("form-v2")).toBe(true);
    expect(isValidEntityId("page-1")).toBe(true);
    expect(isValidEntityId("a1-b2-c3")).toBe(true);
  });

  it("UUID 形式は reject する (kebab-case ではないため)", () => {
    expect(isValidEntityId("12345678-1234-4abc-89ab-1234567890ab")).toBe(false);
  });

  it("大文字混じりは reject する", () => {
    expect(isValidEntityId("User-Form")).toBe(false);
    expect(isValidEntityId("USER")).toBe(false);
    expect(isValidEntityId("userForm")).toBe(false);
  });

  it("空文字 / null / undefined / 非文字列は reject する", () => {
    expect(isValidEntityId("")).toBe(false);
    expect(isValidEntityId(null)).toBe(false);
    expect(isValidEntityId(undefined)).toBe(false);
    expect(isValidEntityId(123)).toBe(false);
  });

  it("64 文字超過は reject する", () => {
    const exact64 = "a".repeat(64);
    const over64 = "a".repeat(65);
    expect(isValidEntityId(exact64)).toBe(true);
    expect(isValidEntityId(over64)).toBe(false);
  });

  it("数字始まりは reject する", () => {
    expect(isValidEntityId("1user")).toBe(false);
    expect(isValidEntityId("9-page")).toBe(false);
  });

  it("連続ハイフン / 先頭末尾ハイフンは reject する", () => {
    expect(isValidEntityId("user--form")).toBe(false);
    expect(isValidEntityId("-user")).toBe(false);
    expect(isValidEntityId("user-")).toBe(false);
  });

  it("アンダースコア / 空白 / 記号は reject する", () => {
    expect(isValidEntityId("user_form")).toBe(false);
    expect(isValidEntityId("user form")).toBe(false);
    expect(isValidEntityId("user.form")).toBe(false);
    expect(isValidEntityId("user/form")).toBe(false);
  });
});
