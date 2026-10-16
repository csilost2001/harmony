import { describe, it, expect } from "vitest";
import { describeNormalization, normalizeAscii, normalizeField, normalizePasted } from "./fieldNormalize";

describe("normalizeAscii", () => {
  it("全角の英数・記号・スペースを半角にし、前後の空白を取る", () => {
    expect(normalizeAscii("ＣｕｓｔｏｍｅｒＩｄ")).toBe("CustomerId");
    expect(normalizeAscii("　ｏｒｄｅｒ－ｉｔｅｍ　")).toBe("order-item");
    expect(normalizeAscii("ｱｲｳ")).toBe("アイウ"); // 半角カナは、全角カナへ (NFKC)
  });
  it("日本語の名称は、そのまま (長音もそのまま)", () => {
    expect(normalizeAscii("注文ステータス")).toBe("注文ステータス");
    expect(normalizeAscii("カラー")).toBe("カラー");
  });
});

describe("normalizePasted / normalizeField", () => {
  it("貼り付けは、改行・タブも除く。変わったかを返す", () => {
    expect(normalizePasted("order_id\n")).toEqual({ value: "order_id", changed: true });
    expect(normalizePasted("order_id")).toEqual({ value: "order_id", changed: false });
    expect(normalizePasted("ＡＢ\tＣ")).toEqual({ value: "ABC", changed: true });
  });
  it("入力欄の値は、前後の空白と全角を直す", () => {
    expect(normalizeField(" ｉｄ ")).toEqual({ value: "id", changed: true });
    expect(normalizeField("id")).toEqual({ value: "id", changed: false });
  });
});

describe("describeNormalization", () => {
  it("空白だけの違いか、全角を直したかを言い分ける", () => {
    expect(describeNormalization(" id ", "id")).toBe("前後の空白を取りました");
    expect(describeNormalization("ＩＤ", "ID")).toBe("全角を半角にしました: 「ＩＤ」→「ID」");
  });
});
