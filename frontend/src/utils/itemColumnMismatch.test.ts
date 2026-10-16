import { describe, it, expect } from "vitest";
import type { ScreenItem, Table } from "../types/v3";
import { fixPatch, itemColumnMismatches } from "./itemColumnMismatch";

const tables = [{
  id: "customer", name: "顧客", physicalName: "customers",
  columns: [
    { id: "c1", physicalName: "name", name: "氏名", dataType: "VARCHAR", length: 30, notNull: true },
    { id: "c2", physicalName: "age", name: "年齢", dataType: "INTEGER" },
    { id: "c3", physicalName: "seq", name: "連番", dataType: "BIGINT", notNull: true, autoIncrement: true },
    { id: "c4", physicalName: "kind", name: "区分", dataType: "VARCHAR", length: 2, notNull: true, defaultValue: "A" },
  ],
}] as unknown as Table[];
const item = (id: string, columnId: string, extra: Record<string, unknown> = {}) => ({ id, label: id, type: "string", direction: "both", binding: { kind: "tableColumn", ref: { tableId: "customer", columnId } }, ...extra }) as unknown as ScreenItem;

describe("itemColumnMismatches (続編 第 8 弾 #156)", () => {
  it("型・最大長・必須の食い違いを集め、項目をカラムに合わせる変更を添える", () => {
    const rows = itemColumnMismatches([item("name", "c1", { maxLength: 50 }), item("age", "c2")], tables);
    expect(rows.map((r) => r.itemId)).toEqual(["name", "age"]);
    const name = rows[0];
    expect(name.mismatches.map((m) => m.kind).sort()).toEqual(["maxLength", "required"]);
    expect(fixPatch(name)).toEqual({ maxLength: 30, required: true });
    const age = rows[1];
    expect(age.mismatches.map((m) => m.kind)).toEqual(["type"]);
    expect(fixPatch(age)).toEqual({ type: "integer" });
  });
  it("最大長が決まっていない文字の項目も、カラムの長さを知らせる", () => {
    const rows = itemColumnMismatches([item("name", "c1", { required: true })], tables);
    expect(rows[0].mismatches.map((m) => m.kind)).toEqual(["maxLength"]);
  });
  it("合っている項目・自動採番・デフォルト値のある NOT NULL・紐づけの無い項目は出さない", () => {
    const ok = item("name", "c1", { maxLength: 30, required: true });
    const seq = item("seq", "c3", { type: "integer" });
    const kind = item("kind", "c4", { maxLength: 2 });
    const free = { id: "free", label: "自由", type: "string" } as unknown as ScreenItem;
    expect(itemColumnMismatches([ok, seq, kind, free], tables)).toEqual([]);
  });
  it("表示専用の項目は、必須を求めない", () => {
    expect(itemColumnMismatches([item("name", "c1", { maxLength: 30, direction: "out" })], tables)).toEqual([]);
  });
  it("カラム・テーブルが見つからないときは、直せない食い違いとして出す", () => {
    const r = itemColumnMismatches([item("x", "zzz"), { ...item("y", "c1"), binding: { kind: "tableColumn", ref: { tableId: "none", columnId: "c1" } } } as unknown as ScreenItem], tables);
    expect(r.map((x) => x.mismatches[0].kind)).toEqual(["missing", "missing"]);
    expect(fixPatch(r[0])).toEqual({});
  });
});
