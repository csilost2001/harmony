import { describe, it, expect } from "vitest";
import { applyTermHint, termKey, termVariantHints } from "./termVariants";

describe("termKey", () => {
  it("語の終わりの長音は同じ語として扱い、途中の長音は残す", () => {
    expect(termKey("ユーザー")).toBe(termKey("ユーザ"));
    expect(termKey("ビル")).not.toBe(termKey("ビール"));
    expect(termKey("ヴァージョン")).toBe(termKey("バージョン"));
  });
});

describe("termVariantHints", () => {
  const known = ["ユーザー名", "ユーザーID", "サーバー", "ユーザー種別"];
  it("ほかで別の書き方が使われている語を示し、いちばん多い書き方を提案する", () => {
    const h = termVariantHints("ユーザ名", known);
    expect(h).toEqual([{ from: "ユーザ", to: "ユーザー", count: 3 }]);
  });
  it("入力と同じ書き方がほかでも使われているときは示さない", () => {
    expect(termVariantHints("ユーザー名", known)).toEqual([]);
    expect(termVariantHints("ユーザ名", ["ユーザ名", "ユーザー名"])).toEqual([]);
  });
  it("ほかに無い語・カタカナの無い入力は示さない", () => {
    expect(termVariantHints("顧客名", known)).toEqual([]);
    expect(termVariantHints("ブラウザ", known)).toEqual([]);
  });
  it("半角カナも全角にそろえて比べる", () => {
    expect(termVariantHints("ｻｰﾊﾞ", known)).toEqual([{ from: "サーバ", to: "サーバー", count: 1 }]);
  });
  it("置き換えは、同じ語の連なりだけ (正しい書き方・別の語・全角の記号は変えない)", () => {
    const k = ["ユーザー名", "ユーザー種別", "ユーザー"];
    const [h] = termVariantHints("ユーザー名とユーザ名", k);
    expect(applyTermHint("ユーザー名とユーザ名", h)).toBe("ユーザー名とユーザー名");
    const [h2] = termVariantHints("ユーザ名とユーザビリティ", k);
    expect(applyTermHint("ユーザ名とユーザビリティ", h2)).toBe("ユーザー名とユーザビリティ");
    const [h3] = termVariantHints("ユーザ名(ＡＢＣ)", k);
    expect(applyTermHint("ユーザ名(ＡＢＣ)", h3)).toBe("ユーザー名(ＡＢＣ)");
    const [h4] = termVariantHints("ｻｰﾊﾞ", ["サーバー"]);
    expect(applyTermHint("ｻｰﾊﾞ", h4)).toBe("サーバー");
  });
  it("置き換える", () => {
    const [h] = termVariantHints("ユーザ名", known);
    expect(applyTermHint("ユーザ名", h)).toBe("ユーザー名");
  });
});
