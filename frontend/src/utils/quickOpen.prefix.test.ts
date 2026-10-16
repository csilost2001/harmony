import { describe, it, expect } from "vitest";
import { highlightSegments, parseKindPrefix } from "./quickOpen";

describe("種類の接頭辞 (続編 第 6 弾 #115)", () => {
  it("t: は テーブルだけ。残りが検索語", () => {
    expect(parseKindPrefix("t:注文")).toEqual({ kinds: ["table"], label: "テーブル", rest: "注文" });
    expect(parseKindPrefix("F: ログイン")).toMatchObject({ kinds: ["process-flow"], rest: "ログイン" });
    expect(parseKindPrefix("ｓ：x").kinds).toBeNull(); // 全角の英字は接頭辞にしない
    expect(parseKindPrefix("s：x")).toMatchObject({ kinds: ["screen"], rest: "x" }); // 全角コロンは可
  });
  it("v: はビューとビュー定義の両方", () => {
    expect(parseKindPrefix("v:").kinds).toEqual(["view", "view-definition"]);
    expect(parseKindPrefix("v:").rest).toBe("");
  });
  it("表に無い文字・コロンの無い語は、ふつうの検索語", () => {
    expect(parseKindPrefix("x:abc")).toEqual({ kinds: null, label: null, rest: "x:abc" });
    expect(parseKindPrefix("table")).toEqual({ kinds: null, label: null, rest: "table" });
    expect(parseKindPrefix("api:v1").kinds).toBeNull();
  });
});

describe("本文の一致の目立たせ方 (続編 第 6 弾 #114)", () => {
  it("検索語に合う部分を区切る", () => {
    expect(highlightSegments("説明: 顧客の住所", "顧客")).toEqual([{ text: "説明: ", hit: false }, { text: "顧客", hit: true }, { text: "の住所", hit: false }]);
  });
  it("全角半角・大文字小文字・ひらがな / カタカナの違いを無視する / 複数語", () => {
    expect(highlightSegments("ＯＲＤＥＲ テーブル", "order").map((s) => s.hit)).toEqual([true, false]);
    expect(highlightSegments("ひらがな", "ヒラ")).toEqual([{ text: "ひら", hit: true }, { text: "がな", hit: false }]);
    expect(highlightSegments("abc def", "abc def").map((s) => s.hit)).toEqual([true, false, true]);
  });
  it("語が空・本文が空・合わない場合は、そのまま", () => {
    expect(highlightSegments("abc", "")).toEqual([{ text: "abc", hit: false }]);
    expect(highlightSegments("", "a")).toEqual([{ text: "", hit: false }]);
    expect(highlightSegments("abc", "z")).toEqual([{ text: "abc", hit: false }]);
  });
});
