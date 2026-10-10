import { describe, it, expect } from "vitest";
import { parseDirection, parseItemTable, splitDuplicateItems, toItemId } from "./itemPaste";

describe("項目 ID", () => {
  it("camelCase に寄せる。日本語だけなら null", () => {
    expect(toItemId("customerId")).toEqual({ value: "customerId", changed: false });
    expect(toItemId("customer_id")).toEqual({ value: "customerId", changed: true });
    expect(toItemId("Order Number")).toEqual({ value: "orderNumber", changed: true });
    expect(toItemId("顧客ID").value).toBeNull();
    expect(toItemId("1abc").value).toBeNull();
  });
  it("入出力の書き方", () => {
    expect(parseDirection("入力")).toBe("in");
    expect(parseDirection("表示")).toBe("out");
    expect(parseDirection("入出力")).toBe("both");
    expect(parseDirection("???")).toBeUndefined();
  });
});

describe("項目定義の表の貼り付け", () => {
  it("見出しつきを読む (型・入出力・必須・桁数・説明)", () => {
    const text = ["項目ID\tラベル\t型\t入出力\t必須\t最大長\t説明", "customer_name\t顧客名\t文字列\t入力\t○\t100\t全角可", "birthDate\t生年月日\t日付\t入力\t\t\t", "total\t合計\t数値\t出力\t\t\t"].join("\n");
    const r = parseItemTable(text);
    expect(r.headerDetected).toBe(true);
    expect(r.items[0]).toMatchObject({ id: "customerName", label: "顧客名", type: "string", direction: "in", required: true, maxLength: 100, description: "全角可" });
    expect(r.items[1]).toMatchObject({ id: "birthDate", type: "date" });
    expect(r.items[2]).toMatchObject({ id: "total", type: "number", direction: "out" });
    expect(r.warnings.join("\n")).toContain("「customer_name」を「customerName」にしました");
  });

  it("見出しなしは 項目 ID・ラベル・型… の順", () => {
    const r = parseItemTable("qty\t数量\tinteger\t入力\t○");
    expect(r.headerDetected).toBe(false);
    expect(r.items[0]).toMatchObject({ id: "qty", label: "数量", type: "integer", direction: "in", required: true });
  });

  it("英語にできない項目 ID の行は読み飛ばし、行番号つきで知らせる", () => {
    const r = parseItemTable("項目ID\tラベル\n顧客名\t顧客名\nname\t名前");
    expect(r.items.map((i) => i.id)).toEqual(["name"]);
    expect(r.warnings.join("\n")).toContain("2 行目: 項目 ID「顧客名」");
  });

  it("知らない型・数字でない桁数・重複を知らせる", () => {
    const r = parseItemTable("項目ID\t型\t最大長\na\tgeometry\t大\na\tint\t5");
    expect(r.items[0].type).toBe("string");
    expect(r.warnings.join("\n")).toContain("型「geometry」");
    expect(r.warnings.join("\n")).toContain("最大長「大」");
    expect(r.warnings.join("\n")).toContain("重複");
  });

  it("既存の項目と ID が同じものは追加しない / 空なら空", () => {
    const parsed = parseItemTable("a\tA\nb\tB").items;
    expect(splitDuplicateItems(parsed, [{ id: "a" as never }]).add.map((i) => i.id)).toEqual(["b"]);
    expect(parseItemTable("\n \n")).toEqual({ items: [], warnings: [], headerDetected: false });
  });
});
