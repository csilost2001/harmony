import { describe, it, expect } from "vitest";
import { itemUpdates, itemsToTsv, parseDirection, parseItemTable, splitDuplicateItems, toItemId } from "./itemPaste";

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
    expect(parseItemTable("\n \n")).toEqual({ items: [], warnings: [], headerDetected: false, fields: [] });
  });
});

describe("項目の表へ書き出し", () => {
  it("書き出した表を貼り付け直すと、同じ項目が読める (往復)", () => {
    const items = [
      { id: "customerName", label: "顧客名", type: "string", direction: "in", required: true, maxLength: 100, description: "全角可" },
      { id: "birthDate", label: "生年月日", type: "date", direction: "in" },
      { id: "total", label: "合計", type: "number", direction: "out", min: 0, max: 999999 },
    ] as never[];
    const back = parseItemTable(itemsToTsv(items));
    expect(back.warnings).toEqual([]);
    expect(back.items).toEqual(items);
  });
});

describe("項目の型に長さがついた書き方", () => {
  it("`varchar(100)` は、型 string と最大長 100 として読む", () => {
    const r = parseItemTable("項目ID\t型\nname\tvarchar(100)");
    expect(r.items[0]).toMatchObject({ id: "name", type: "string", maxLength: 100 });
    expect(r.warnings).toEqual([]);
  });
  it("引用符つきのセル (改行入りの説明) も読める", () => {
    const r = parseItemTable('項目ID\t説明\na\t"1 行目\n2 行目"\nb\t');
    expect(r.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(r.items[0].description).toBe("1 行目\n2 行目");
  });
});

describe("閉じていない引用符", () => {
  it("警告を出す (以降の行が 1 セルに吸収されたことに気づけるように)", () => {
    const r = parseItemTable('項目ID\ta\nx\t"閉じていない\ny\tz');
    expect(r.warnings.join("")).toContain("閉じていない引用符");
  });
});

describe("既存項目の更新 (同じ ID の行)", () => {
  const existing = [
    { id: "qty", label: "数量", type: "integer", required: true, min: 1, max: 99, description: "旧" },
    { id: "memo", label: "メモ", type: "string", maxLength: 50 },
  ] as never[];

  it("表にある項目だけを書き換え、空にした項目は外す。変わらない項目は出さない", () => {
    const r = parseItemTable("項目ID\tラベル\t必須\t最大値\t説明\nqty\t購入数\t\t50\t新\nmemo\tメモ\t\t\t");
    const up = itemUpdates(r.items, existing, r.fields);
    expect(up.map((u) => u.id)).toEqual(["qty"]);
    expect(up[0].patch).toEqual({ label: "購入数", required: undefined, max: 50, description: "新" });
    // 表に無い「型」「最小値」は既存のまま
    expect(Object.keys(up[0].patch)).not.toContain("type");
    expect(Object.keys(up[0].patch)).not.toContain("min");
  });
});
