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
  VALUE_SOURCE_KINDS,
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

describe("VALUE_SOURCE_KINDS", () => {
  it("4 種類の valueFrom kind を持つ (flowVariable / tableColumn / viewColumn / expression)", () => {
    const values = VALUE_SOURCE_KINDS.map((k) => k.value);
    expect(values).toEqual(["flowVariable", "tableColumn", "viewColumn", "expression"]);
  });

  it("各 kind に label が日本語で設定されている", () => {
    const labels = VALUE_SOURCE_KINDS.map((k) => k.label);
    expect(labels).toEqual(["処理フロー変数", "テーブル列", "ビュー列", "計算式"]);
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
