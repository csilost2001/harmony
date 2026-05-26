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

  // I-7 Round 2 (#1299 Codex review M-1) regression: alpha-leading UUID (先頭が a-f) は
  // ENTITY_ID_RE に偶然合致するため、UUID_LOOSE_RE で明示的に除外している。
  // compat shim 撤廃 (Phase A) の意図を保ち、frontend 創成 / rename ダイアログで
  // 旧 UUID id を入力 / 提案させないことを保証する。
  it("alpha-leading UUID も reject する (#1299 Codex M-1 regression)", () => {
    expect(isValidEntityId("a0000000-0000-4000-8000-000000000000")).toBe(false);
    expect(isValidEntityId("f81dd9e0-794c-4539-a2a5-9cbcc0a75899")).toBe(false);
    expect(isValidEntityId("b1234567-89ab-4cde-9f01-23456789abcd")).toBe(false);
    expect(isValidEntityId("c0ffeebe-1234-4567-89ab-cdef01234567")).toBe(false);
    expect(isValidEntityId("deadbeef-1234-4abc-8def-1234567890ab")).toBe(false);
    expect(isValidEntityId("e1f2a3b4-c5d6-4e7f-89a0-b1c2d3e4f506")).toBe(false);
    // version digit が 4 でない loose UUID (v1/v3 等) も EntityId としては reject
    expect(isValidEntityId("a0000000-0000-1000-8000-000000000000")).toBe(false);
  });

  it("UUID と segment 数が異なる kebab-case は accept する (false-positive 回避)", () => {
    expect(isValidEntityId("abc-def")).toBe(true);
    expect(isValidEntityId("a0-b1-c2")).toBe(true);
    expect(isValidEntityId("abc12345")).toBe(true);
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
