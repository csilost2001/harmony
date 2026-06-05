/**
 * ScreenItemsView 共通定数の整合性テスト (#1145 Phase-6)
 *
 * 旧 inline 定義から `internal/screenItemsConstants.ts` に抽出された定数を検証。
 * 値の数 / 内容 / 期待される識別子マッチング 等の retain 確認。
 */
import { describe, it, expect } from "vitest";
import {
  PRIMITIVE_TYPES,
  DISPLAY_FORMAT_PRESETS,
  BINDING_KINDS,
  JS_IDENTIFIER_RE,
} from "./screenItemsConstants";

describe("PRIMITIVE_TYPES", () => {
  it("7 種類の primitive 型を含む", () => {
    expect(PRIMITIVE_TYPES).toEqual([
      "string", "number", "integer", "boolean", "date", "datetime", "json",
    ]);
  });
});

describe("DISPLAY_FORMAT_PRESETS", () => {
  it("代表的な日付/数値フォーマットを含む", () => {
    expect(DISPLAY_FORMAT_PRESETS).toContain("YYYY/MM/DD");
    expect(DISPLAY_FORMAT_PRESETS).toContain("YYYY年MM月DD日");
    expect(DISPLAY_FORMAT_PRESETS).toContain("#,##0");
    expect(DISPLAY_FORMAT_PRESETS).toContain("¥#,##0");
  });

  it("11 個の preset がある", () => {
    expect(DISPLAY_FORMAT_PRESETS).toHaveLength(11);
  });
});

describe("BINDING_KINDS", () => {
  it("Form / DTO / JSON / Flow / DB / context 系 binding kind を持つ", () => {
    const values = BINDING_KINDS.map((k) => k.value);
    expect(values).toEqual([
      "form",
      "dto",
      "json",
      "flowVariable",
      "tableColumn",
      "viewColumn",
      "expression",
      "catalog",
      "routeParam",
      "queryParam",
      "session",
      "fragmentParam",
    ]);
  });

  it("主要 kind に label が設定されている", () => {
    const labels = BINDING_KINDS.map((k) => k.label);
    expect(labels).toContain("Form");
    expect(labels).toContain("DTO");
    expect(labels).toContain("処理フロー変数");
    expect(labels).toContain("テーブル列");
  });
});

describe("JS_IDENTIFIER_RE", () => {
  it("有効な JS identifier にマッチする", () => {
    expect(JS_IDENTIFIER_RE.test("foo")).toBe(true);
    expect(JS_IDENTIFIER_RE.test("foo123")).toBe(true);
    expect(JS_IDENTIFIER_RE.test("_foo")).toBe(true);
    expect(JS_IDENTIFIER_RE.test("$foo")).toBe(true);
    expect(JS_IDENTIFIER_RE.test("FOO_BAR")).toBe(true);
  });

  it("無効な identifier には マッチしない", () => {
    expect(JS_IDENTIFIER_RE.test("")).toBe(false);
    expect(JS_IDENTIFIER_RE.test("123foo")).toBe(false);
    expect(JS_IDENTIFIER_RE.test("foo-bar")).toBe(false);
    expect(JS_IDENTIFIER_RE.test("foo.bar")).toBe(false);
    expect(JS_IDENTIFIER_RE.test("foo bar")).toBe(false);
  });
});
