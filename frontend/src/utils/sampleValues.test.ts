import { describe, it, expect } from "vitest";
import { sampleText } from "./sampleValues";

describe("sampleText (続編 第 8 弾 #141)", () => {
  it("名前から、それらしい値を作る (氏名・住所・電話・メール・金額・コード)", () => {
    expect(sampleText({ label: "氏名", type: "string" }, "typical")).toBe("山田 太郎");
    expect(sampleText({ label: "氏名", type: "string" }, "typical", 1)).toBe("佐藤 花子");
    expect(sampleText({ label: "フリガナ", type: "string" }, "typical")).toContain("ヤマダ");
    expect(sampleText({ label: "届け先住所", type: "string" }, "typical")).toContain("東京都");
    expect(sampleText({ label: "電話番号", type: "string" }, "typical")).toBe("03-1234-5678");
    expect(sampleText({ label: "メールアドレス", type: "string" }, "typical")).toBe("taro1@example.com");
    expect(sampleText({ label: "商品コード", type: "string" }, "typical", 2)).toBe("A0003");
    expect(sampleText({ label: "金額", type: "number" }, "typical")).toBe("12,800");
    expect(sampleText({ label: "数量", type: "integer" }, "typical")).toBe("3");
  });
  it("桁数があれば、ふつうの値でも超えない", () => {
    expect(sampleText({ label: "住所", type: "string", maxLength: 6 }, "typical")).toHaveLength(6);
  });
  it("桁数いっぱい: 文字は上限ちょうど、数値は桁いっぱい (max があればその値)", () => {
    expect(sampleText({ label: "備考", type: "string", maxLength: 30 }, "max")).toHaveLength(30);
    expect(sampleText({ label: "数量", type: "integer", maxLength: 5 }, "max")).toBe("99999");
    expect(sampleText({ label: "数量", type: "integer", max: 9999 }, "max")).toBe("9999");
  });
  it("長い値: 上限の 9 割まで (上限が無ければ、ふつうの値より長い)", () => {
    expect(sampleText({ label: "備考", type: "string", maxLength: 100 }, "long")).toHaveLength(90);
    const typ = sampleText({ label: "備考", type: "string" }, "typical");
    expect(sampleText({ label: "備考", type: "string" }, "long").length).toBeGreaterThan(typ.length);
  });
  it("日付・日時・真偽", () => {
    expect(sampleText({ label: "注文日", type: "date" }, "typical")).toBe("2026/10/16");
    expect(sampleText({ label: "更新", type: "datetime" }, "max")).toBe("2026/12/31 23:59");
    expect(sampleText({ label: "確認済み", type: "boolean" }, "typical", 0)).toBe("✓");
    expect(sampleText({ label: "確認済み", type: "boolean" }, "typical", 1)).toBe("");
  });
  it("なし・空は空文字。同じ入力は同じ値", () => {
    expect(sampleText({ label: "氏名" }, "off")).toBe("");
    expect(sampleText({ label: "氏名" }, "empty")).toBe("");
    expect(sampleText({ label: "氏名" }, "typical", 3)).toBe(sampleText({ label: "氏名" }, "typical", 3));
  });
});
