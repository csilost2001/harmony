import { describe, it, expect } from "vitest";
import { fieldTypeForDataType, toCamelIdentifier, uniqueId, itemsFromTable, planItemAutofill, draftErrorMessages } from "./itemSuggestion";
import type { Table, Column } from "../types/v3";

const col = (o: Record<string, unknown>) => o as unknown as Column;
const table = { id: "customers", name: "顧客", physicalName: "customers" } as unknown as Table;

describe("itemSuggestion", () => {
  it("DB の型 → 画面項目の型", () => {
    expect(fieldTypeForDataType("VARCHAR")).toBe("string");
    expect(fieldTypeForDataType("bigint")).toBe("integer");
    expect(fieldTypeForDataType("DECIMAL")).toBe("number");
    expect(fieldTypeForDataType("TIMESTAMP")).toBe("datetime");
    expect(fieldTypeForDataType("BLOB")).toBeNull();
  });

  it("物理名 → camelCase の ID / 重なれば番号", () => {
    expect(toCamelIdentifier("customer_name")).toBe("customerName");
    expect(toCamelIdentifier("1st_value")).toBe("c1stValue");
    expect(uniqueId("a", new Set(["a", "a2"]))).toBe("a3");
    expect(uniqueId("b", new Set(["a"]))).toBe("b");
  });

  describe("itemsFromTable", () => {
    const columns = [
      col({ id: "c1", physicalName: "customer_id", name: "顧客ID", dataType: "BIGINT", primaryKey: true, notNull: true, autoIncrement: true }),
      col({ id: "c2", physicalName: "customer_name", name: "顧客名", dataType: "VARCHAR", length: 100, notNull: true, comment: "漢字" }),
      col({ id: "c3", physicalName: "photo", name: "写真", dataType: "BLOB" }),
      col({ id: "c4", physicalName: "birth_date", name: "生年月日", dataType: "DATE" }),
    ];
    it("型・必須・最大長・紐づけ付きの項目を作り、変換できないカラムは飛ばす", () => {
      const { items, skipped } = itemsFromTable(table, columns, []);
      expect(skipped).toEqual(["photo"]);
      expect(items.map((i) => i.id)).toEqual(["customerId", "customerName", "birthDate"]);
      expect(items[0]).toMatchObject({ type: "integer", readonly: true, binding: { kind: "tableColumn", ref: { tableId: "customers", columnId: "c1" } } });
      expect(items[0].required).toBeUndefined(); // 自動採番は入力しない
      expect(items[1]).toMatchObject({ type: "string", required: true, maxLength: 100, label: "顧客名", description: "漢字" });
      expect(items[2]).toMatchObject({ type: "date", direction: "both" });
    });
    it("既にある項目 ID と重ならない", () => {
      const { items } = itemsFromTable(table, columns.slice(1, 2), ["customerName"]);
      expect(items[0].id).toBe("customerName2");
    });
  });

  describe("planItemAutofill", () => {
    const blank = { id: "", label: "", type: "string" as const };
    it("ラベルから ID・型・最大長を埋める", () => {
      const r = planItemAutofill({ ...blank, label: "顧客名" }, []);
      expect(r?.patch).toEqual({ id: "customerName", type: "string", maxLength: 100 } satisfies Record<string, unknown>);
    });
    it("型だけ: 金額 → number", () => {
      const r = planItemAutofill({ ...blank, id: "amount", label: "合計金額" }, ["amount"]);
      expect(r?.patch).toEqual({ type: "number" });
    });
    it("決めた ID・型は変えない / 辞書に無いラベルは何もしない", () => {
      expect(planItemAutofill({ ...blank, id: "x", label: "合計金額", type: "number" }, [])).toBeNull();
      expect(planItemAutofill({ ...blank, id: "x", label: "合計金額", maxLength: 5 }, [])).toBeNull();
      expect(planItemAutofill({ ...blank, label: "犬種" }, [])).toBeNull();
      expect(planItemAutofill({ ...blank, label: "" }, [])).toBeNull();
    });
    it("ID は重ならないようにする", () => {
      const r = planItemAutofill({ ...blank, label: "顧客名" }, ["customerName"]);
      expect(r?.patch.id).toBe("customerName2");
    });
  });

  describe("draftErrorMessages", () => {
    it("設定に応じて、まだ書いていないものだけ下書きを作る", () => {
      const r = draftErrorMessages({ label: "顧客名", required: true, maxLength: 100, errorMessages: { required: "手書き" } });
      expect(r).toEqual({ maxLength: "顧客名は100文字以内で入力してください" });
    });
    it("範囲・形式", () => {
      const r = draftErrorMessages({ label: "年齢", min: 0, max: 120, pattern: "^\\d+$" });
      expect(r.outOfRange).toBe("年齢は0〜120の範囲で入力してください");
      expect(r.invalidFormat).toBe("年齢の形式が正しくありません");
      expect(draftErrorMessages({ label: "数", min: 1 }).outOfRange).toBe("数は1以上で入力してください");
      expect(draftErrorMessages({ label: "数", max: 9 }).outOfRange).toBe("数は9以下で入力してください");
    });
    it("規約に同じキーのメッセージがあれば、その参照にする", () => {
      expect(draftErrorMessages({ label: "x", required: true }, new Set(["required"]))).toEqual({ required: "@conv.msg.required" });
    });
    it("設定が無ければ空 / ラベルが空なら「この項目」", () => {
      expect(draftErrorMessages({ label: "x" })).toEqual({});
      expect(draftErrorMessages({ label: "", required: true }).required).toBe("この項目は必須です");
    });
  });
});
