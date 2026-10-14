import { describe, it, expect } from "vitest";
import { applyBulkPatch, planBulkEdit, type BulkField } from "./bulkEdit";

interface Col { id: string; dataType: string; length?: number; notNull?: boolean }
const fields: BulkField<Col>[] = [
  { key: "dataType", label: "データ型", kind: "select" },
  { key: "length", label: "長さ", kind: "number", applicable: (c) => (c.dataType === "VARCHAR" ? null : "この型には長さがありません"), validate: (v) => (typeof v === "number" && v > 0 ? null : "1 以上の整数") },
  { key: "notNull", label: "NOT NULL", kind: "tri" },
];
const cols: Col[] = [{ id: "a", dataType: "VARCHAR", length: 50 }, { id: "b", dataType: "INTEGER" }, { id: "c", dataType: "VARCHAR", length: 100, notNull: true }];

describe("planBulkEdit", () => {
  it("行ごとに、変わる項目と変わる前の値を出す。すでにその値の行は変えない", () => {
    const p = planBulkEdit(cols, fields, [{ key: "notNull", value: true }]);
    expect(p.rows.map((r) => r.patch)).toEqual([{ notNull: true }, { notNull: true }, {}]);
    expect(p.rows[0].before).toEqual({ notNull: undefined });
    expect(p.changedRows).toBe(2);
  });

  it("その行に設定できない項目は飛ばし、理由を残す (ほかの項目は反映する)", () => {
    const p = planBulkEdit(cols, fields, [{ key: "length", value: 200 }, { key: "notNull", value: false }]);
    expect(p.rows[1].patch).toEqual({ notNull: false });
    expect(p.rows[1].skipped).toEqual([{ key: "length", reason: "この型には長さがありません" }]);
    expect(p.rows[0].patch).toEqual({ length: 200, notNull: false });
  });

  it("同じ操作でデータ型も変えるなら、新しいデータ型で「設定できるか」を判定する", () => {
    const p = planBulkEdit(cols, fields, [{ key: "dataType", value: "VARCHAR" }, { key: "length", value: 30 }]);
    expect(p.rows[1].patch).toEqual({ dataType: "VARCHAR", length: 30 }); // INTEGER の行も、VARCHAR になるので長さを設定できる
    const q = planBulkEdit(cols, fields, [{ key: "dataType", value: "INTEGER" }, { key: "length", value: 30 }]);
    expect(q.rows[0].skipped).toEqual([{ key: "length", reason: "この型には長さがありません" }]);
  });

  it("値が誤りなら、どの行にも反映せず、理由を返す", () => {
    const p = planBulkEdit(cols, fields, [{ key: "length", value: -3 }]);
    expect(p.invalid).toEqual([{ key: "length", reason: "1 以上の整数" }]);
    expect(p.changedRows).toBe(0);
  });

  it("空にする (undefined) は、値がある行だけが変わる。検証の対象にしない", () => {
    const p = planBulkEdit(cols, fields, [{ key: "length", value: undefined }]);
    expect(p.invalid).toEqual([]);
    expect(p.rows.map((r) => "length" in r.patch)).toEqual([true, false, true]);
  });

  it("数値の欄に数でない値が入っていたら、誤りとして返す", () => {
    const p = planBulkEdit(cols, fields, [{ key: "length", value: Number.NaN }]);
    expect(p.invalid).toEqual([{ key: "length", reason: "数値を入力してください" }]);
  });

  it("知らない項目の変更は無視する。元の行は書き換えない", () => {
    const copy = JSON.parse(JSON.stringify(cols)) as Col[];
    const p = planBulkEdit(copy, fields, [{ key: "zzz", value: 1 }, { key: "dataType", value: "TEXT" }]);
    expect(p.rows[0].patch).toEqual({ dataType: "TEXT" });
    expect(copy).toEqual(cols);
  });
});

describe("applyBulkPatch", () => {
  it("値を設定し、undefined のキーは消す", () => {
    const c: Col = { id: "a", dataType: "VARCHAR", length: 50 };
    applyBulkPatch(c, { dataType: "TEXT", length: undefined });
    expect(c).toEqual({ id: "a", dataType: "TEXT" });
    expect("length" in c).toBe(false);
  });
});
