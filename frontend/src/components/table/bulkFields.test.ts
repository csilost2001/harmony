import { describe, it, expect } from "vitest";
import { planBulkEdit } from "../../utils/bulkEdit";
import { COLUMN_BULK_FIELDS } from "./bulkColumnFields";
import { ITEM_BULK_FIELDS } from "../screen-items/bulkItemFields";
import type { Column } from "../../types/v3";
import type { ScreenItem } from "../../types/v3/screen-item";

const col = (id: string, dataType: string, extra: Record<string, unknown> = {}) => ({ id, no: 1, physicalName: id, name: id, dataType, ...extra }) as unknown as Column;
const item = (id: string, type: unknown, extra: Record<string, unknown> = {}) => ({ id, label: id, type, ...extra }) as unknown as ScreenItem;

describe("カラムの一括変更の項目", () => {
  const cols = [col("a", "VARCHAR", { length: 10 }), col("b", "INTEGER"), col("c", "DECIMAL", { length: 10, scale: 2 })];
  it("長さは VARCHAR・CHAR・DECIMAL・FLOAT だけ、スケールは DECIMAL だけに設定できる。ほかの型の行は飛ばして理由を出す", () => {
    const p = planBulkEdit(cols, COLUMN_BULK_FIELDS, [{ key: "length", value: 50 }, { key: "scale", value: 3 }]);
    expect(p.rows[0].patch).toEqual({ length: 50 });
    expect(p.rows[0].skipped.map((s) => s.key)).toEqual(["scale"]);
    expect(p.rows[1].skipped.map((s) => s.key)).toEqual(["length", "scale"]);
    expect(p.rows[2].patch).toEqual({ length: 50, scale: 3 });
  });
  it("同じ操作でデータ型も変えるなら、新しい型で判定する。長さに負の数・小数は誤り", () => {
    const p = planBulkEdit(cols, COLUMN_BULK_FIELDS, [{ key: "dataType", value: "VARCHAR" }, { key: "length", value: 30 }]);
    expect(p.rows[1].patch).toEqual({ dataType: "VARCHAR", length: 30 });
    expect(planBulkEdit(cols, COLUMN_BULK_FIELDS, [{ key: "length", value: -1 }]).invalid).toHaveLength(1);
    expect(planBulkEdit(cols, COLUMN_BULK_FIELDS, [{ key: "length", value: 1.5 }]).invalid).toHaveLength(1);
  });
});

describe("画面項目の一括変更の項目", () => {
  const items = [item("name", "string"), item("age", "integer"), item("rows", { kind: "array", itemType: "json" }), item("ok", "boolean")];
  it("最大長・パターンは文字列だけ、最小値・最大値は数値・整数だけ。配列・オブジェクトの型は、型を変えない", () => {
    const p = planBulkEdit(items, ITEM_BULK_FIELDS, [{ key: "maxLength", value: 20 }, { key: "max", value: 99 }, { key: "type", value: "string" }]);
    expect(p.rows[0].patch).toEqual({ maxLength: 20 }); // 文字列: 最大長だけ (type は同じ)
    expect(p.rows[1].patch).toEqual({ max: 99, type: "string" });
    expect(p.rows[1].skipped.map((s) => s.key)).toEqual(["maxLength"]);
    expect(p.rows[2].skipped.some((s) => s.key === "type")).toBe(true);
    expect(p.rows[3].skipped.map((s) => s.key)).toEqual(["maxLength", "max"]);
  });
  it("必須・入出力・説明は、どの型にも設定できる。空にすると値を消す", () => {
    const p = planBulkEdit([item("a", "string", { required: true, description: "x" })], ITEM_BULK_FIELDS, [{ key: "required", value: undefined }, { key: "direction", value: "both" }, { key: "description", value: undefined }]);
    expect(p.rows[0].patch).toEqual({ required: undefined, direction: "both", description: undefined });
  });
});
