import { describe, it, expect } from "vitest";
import {
  applyNamingConvention, splitWords, buildTermIndex, suggestPhysicalName, suggestColumnType, parseNamingConvention, isPlaceholderColumn,
} from "./columnSuggestion";

describe("applyNamingConvention / splitWords", () => {
  it("規約の表記にそろえる", () => {
    expect(applyNamingConvention(["customer", "name"])).toBe("customer_name");
    expect(applyNamingConvention(["customer", "name"], "camelCase")).toBe("customerName");
    expect(applyNamingConvention(["customer", "name"], "PascalCase")).toBe("CustomerName");
    expect(applyNamingConvention(["customer", "name"], "UPPER_SNAKE_CASE")).toBe("CUSTOMER_NAME");
    expect(applyNamingConvention(["customer", "name"], "kebab-case")).toBe("customer-name");
  });
  it("英数字を単語に分ける", () => {
    expect(splitWords("customerName")).toEqual(["customer", "name"]);
    expect(splitWords("Order Item-No")).toEqual(["order", "item", "no"]);
  });
  it("分からない規約は snake_case", () => {
    expect(parseNamingConvention("camelCase")).toBe("camelCase");
    expect(parseNamingConvention("???")).toBe("snake_case");
    expect(parseNamingConvention(undefined)).toBe("snake_case");
  });
});

describe("suggestPhysicalName", () => {
  it("辞書で日本語を英語にする", () => {
    expect(suggestPhysicalName("顧客名")).toEqual({ name: "customer_name", complete: true, source: "辞書" });
    expect(suggestPhysicalName("注文日時")?.name).toBe("order_datetime");
    expect(suggestPhysicalName("作成日時")?.name).toBe("created_at");
    expect(suggestPhysicalName("合計金額")?.name).toBe("total_amount");
    expect(suggestPhysicalName("メールアドレス")?.name).toBe("email");
  });

  it("規約の表記にそろえる", () => {
    expect(suggestPhysicalName("顧客名", undefined, "camelCase")?.name).toBe("customerName");
    expect(suggestPhysicalName("顧客名", undefined, "UPPER_SNAKE_CASE")?.name).toBe("CUSTOMER_NAME");
  });

  it("辞書に無い言葉が残るときは、間違った名前を出さずに null (complete=false)", () => {
    expect(suggestPhysicalName("犬種")).toEqual({ name: null, complete: false, source: "辞書" });
    expect(suggestPhysicalName("顧客の犬種")?.name).toBeNull();
  });

  it("英数字だけの表示名は、整えるだけ", () => {
    expect(suggestPhysicalName("Order Item No")).toEqual({ name: "order_item_no", complete: true, source: "英数字" });
    expect(suggestPhysicalName("userId", undefined, "camelCase")?.name).toBe("userId");
  });

  it("英数字が混ざる日本語も扱う", () => {
    expect(suggestPhysicalName("顧客ID")?.name).toBe("customer_id");
    expect(suggestPhysicalName("ＩＤ")?.name).toBe("id");
  });

  it("同じ表示名の既存の列があれば、その物理名を優先する (いちばん多いもの)", () => {
    const index = buildTermIndex([
      [{ physicalName: "cust_nm", name: "顧客名" }],
      [{ physicalName: "cust_nm", name: "顧客名" }, { physicalName: "customer_name", name: "顧客名" }],
    ]);
    expect(suggestPhysicalName("顧客名", index)).toEqual({ name: "cust_nm", complete: true, source: "既存の列" });
  });

  it("既存の列の表示名を、区切りの手がかりにする (辞書に無い言葉)", () => {
    const index = buildTermIndex([[{ physicalName: "breed", name: "犬種" }]]);
    expect(suggestPhysicalName("顧客の犬種", index)?.name).toBe("customer_breed");
  });

  it("空は null / 仮の列は索引に入れない", () => {
    expect(suggestPhysicalName("  ")).toBeNull();
    const index = buildTermIndex([[{ physicalName: "new_column", name: "顧客名" }, { physicalName: "x", name: "新規カラム" }]]);
    expect(index.byDisplay.size).toBe(0);
    expect(isPlaceholderColumn({ physicalName: "new_column_2", name: "a" })).toBe(true);
    expect(isPlaceholderColumn({ physicalName: "name", name: "名前" })).toBe(false);
  });
});

describe("suggestColumnType", () => {
  const t = (s: string) => suggestColumnType(s);
  it("日付・日時・時刻", () => {
    expect(t("作成日時")).toMatchObject({ dataType: "TIMESTAMP" });
    expect(t("生年月日")).toMatchObject({ dataType: "DATE" });
    expect(t("納期")).toMatchObject({ dataType: "DATE" });
    expect(t("開始時刻")).toMatchObject({ dataType: "TIME" });
    expect(t("曜日")).toBeNull();
  });
  it("金額・率・数量", () => {
    expect(t("合計金額")).toMatchObject({ dataType: "DECIMAL", length: 12, scale: 2 });
    expect(t("単価")).toMatchObject({ dataType: "DECIMAL" });
    expect(t("税率")).toMatchObject({ dataType: "DECIMAL", length: 5, scale: 2 });
    expect(t("注文数量")).toMatchObject({ dataType: "INTEGER" });
    expect(t("在庫数")).toMatchObject({ dataType: "INTEGER" });
  });
  it("フラグは真偽値・NOT NULL", () => {
    expect(t("削除フラグ")).toMatchObject({ dataType: "BOOLEAN", notNull: true });
  });
  it("ID・コード・名称・文章", () => {
    expect(t("顧客ID")).toMatchObject({ dataType: "BIGINT" });
    expect(t("商品コード")).toMatchObject({ dataType: "VARCHAR", length: 20 });
    expect(t("顧客名")).toMatchObject({ dataType: "VARCHAR", length: 100 });
    expect(t("メールアドレス")).toMatchObject({ dataType: "VARCHAR", length: 254 });
    expect(t("備考")).toMatchObject({ dataType: "TEXT" });
    expect(t("住所")).toMatchObject({ dataType: "VARCHAR", length: 200 });
  });
  it("規則に当たらなければ null", () => {
    expect(t("犬種")).toBeNull();
    expect(t("")).toBeNull();
  });
});

import { planColumnAutofill } from "./columnSuggestion";

describe("planColumnAutofill", () => {
  const blank = { physicalName: "new_column", dataType: "VARCHAR", length: undefined };

  it("新しい列に表示名を入れたら、物理名と型を埋める", () => {
    const r = planColumnAutofill(blank, "合計金額", []);
    expect(r?.patch).toEqual({ physicalName: "total_amount", dataType: "DECIMAL", length: 12, scale: 2 });
    expect(r?.message).toContain("total_amount");
    expect(r?.message).toContain("DECIMAL(12,2)");
    expect(r?.message).toContain("Ctrl+Z");
  });

  it("利用者が決めた物理名・型は変えない", () => {
    expect(planColumnAutofill({ physicalName: "amt", dataType: "VARCHAR" }, "顧客名", [])?.patch).toEqual({ dataType: "VARCHAR", length: 100 });
    expect(planColumnAutofill({ physicalName: "new_column", dataType: "INTEGER" }, "顧客名", [])?.patch).toEqual({ physicalName: "customer_name" });
    expect(planColumnAutofill({ physicalName: "x", dataType: "INTEGER" }, "顧客名", [])).toBeNull();
  });

  it("同じ物理名の列が既にあれば、物理名は埋めない (型は埋める)", () => {
    const r = planColumnAutofill(blank, "顧客名", [{ physicalName: "customer_name" }]);
    expect(r?.patch.physicalName).toBeUndefined();
    expect(r?.patch.dataType).toBe("VARCHAR");
  });

  it("既存の同名の列の型を引き継ぐ", () => {
    const index = buildTermIndex([[{ physicalName: "breed", name: "犬種", dataType: "CHAR", length: 3, notNull: true }]]);
    expect(planColumnAutofill(blank, "犬種", [], index)?.patch).toEqual({ physicalName: "breed", dataType: "CHAR", length: 3, notNull: true });
  });

  it("分からなければ null / 初期の表示名や空では何もしない", () => {
    expect(planColumnAutofill(blank, "犬種", [])).toBeNull();
    expect(planColumnAutofill(blank, "新規カラム", [])).toBeNull();
    expect(planColumnAutofill(blank, "  ", [])).toBeNull();
  });

  it("フラグは NOT NULL も入る", () => {
    expect(planColumnAutofill(blank, "削除フラグ", [])?.patch).toMatchObject({ dataType: "BOOLEAN", notNull: true, physicalName: "deleted_flag" });
  });
});

import { columnNameHints } from "./columnSuggestion";

describe("columnNameHints", () => {
  const index = buildTermIndex([
    [{ physicalName: "customer_name", name: "顧客名" }],
    [{ physicalName: "customer_name", name: "顧客名" }],
    [{ physicalName: "once_only", name: "一回だけ" }],
  ]);

  it("同じ表示名がほかでは別の物理名 (2 件以上) なら、用語のヒントを出す", () => {
    const h = columnNameHints({ physicalName: "cust_nm", name: "顧客名" }, index);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ kind: "term", fix: "customer_name" });
    expect(h[0].message).toContain("2 件");
  });

  it("同じ物理名なら出さない / 1 件だけの使われ方では出さない / camelCase と snake_case の違いは表記のヒントにする", () => {
    expect(columnNameHints({ physicalName: "customer_name", name: "顧客名" }, index)).toEqual([]);
    expect(columnNameHints({ physicalName: "other", name: "一回だけ" }, index)).toEqual([]);
    const h = columnNameHints({ physicalName: "customerName", name: "顧客名" }, index);
    expect(h).toEqual([expect.objectContaining({ kind: "case", fix: "customer_name" })]);
  });

  it("規約の表記で判定する", () => {
    expect(columnNameHints({ physicalName: "customer_name", name: "x" }, undefined, "camelCase")).toEqual([expect.objectContaining({ fix: "customerName" })]);
    expect(columnNameHints({ physicalName: "customerName", name: "x" }, undefined, "camelCase")).toEqual([]);
  });

  it("仮の列・空・英数字以外を含む物理名では出さない", () => {
    expect(columnNameHints({ physicalName: "new_column", name: "x" }, index)).toEqual([]);
    expect(columnNameHints({ physicalName: "", name: "x" }, index)).toEqual([]);
    expect(columnNameHints({ physicalName: "顧客名", name: "x" }, index)).toEqual([]);
  });
});
