import { describe, it, expect } from "vitest";
import { editDistance, nearNames } from "./nearNames";

describe("editDistance", () => {
  it("1 文字の違いは 1", () => {
    expect(editDistance("order", "orders")).toBe(1);
    expect(editDistance("order", "ordar")).toBe(1);
    expect(editDistance("abc", "abc")).toBe(0);
  });
  it("上限を超えたら上限 + 1", () => {
    expect(editDistance("abcdef", "uvwxyz", 2)).toBe(3);
    expect(editDistance("a", "abcdefgh", 3)).toBe(4);
  });
});

describe("nearNames (続編 第 6 弾 #120)", () => {
  const names = ["受注一覧", "受注登録", "顧客マスタ", "出荷指示", "customer", "orders"];
  it("打ち間違い・一部だけ合う名前を、近い順に返す", () => {
    expect(nearNames("受注登禄", names)).toContain("受注登録");
    expect(nearNames("order", names)[0]).toBe("orders");
    expect(nearNames("顧客", names)).toContain("顧客マスタ");
  });
  it("カタカナ / ひらがな・全角半角を無視する", () => {
    expect(nearNames("こきゃくマスタ", ["顧客マスタ", "コキャクマスタ"])[0]).toBe("コキャクマスタ");
    expect(nearNames("ＯＲＤＥＲＳ", names)).toContain("orders");
  });
  it("遠いものは出さない / 1 文字の検索語・空は出さない / 件数の上限", () => {
    expect(nearNames("zzzzzz", names)).toEqual([]);
    expect(nearNames("受", names)).toEqual([]);
    expect(nearNames("", names)).toEqual([]);
    expect(nearNames("受注", ["受注A", "受注B", "受注C", "受注D"], 2)).toHaveLength(2);
  });
});
