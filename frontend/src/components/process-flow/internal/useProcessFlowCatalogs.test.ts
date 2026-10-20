import { describe, expect, it } from "vitest";
import { uniqueKeysOf } from "./useProcessFlowCatalogs";

const cols = [
  { id: "c1", physicalName: "order_id" },
  { id: "c2", physicalName: "line_no" },
  { id: "c3", physicalName: "code", unique: true },
  { id: "c4", physicalName: "ref" },
  { id: "c5", physicalName: "email" },
];

describe("uniqueKeysOf (1 行を決める列の組)", () => {
  it("単一列の主キー・単独の一意列・複合主キー (制約)・一意制約・一意インデックス (部分インデックスは除く)", () => {
    expect(uniqueKeysOf({ columns: [{ id: "a", physicalName: "id", primaryKey: true }, { id: "b", physicalName: "email", unique: true }] })).toEqual([["id"], ["email"]]);
    expect(uniqueKeysOf({ columns: cols, constraints: [{ kind: "primaryKey", columnIds: ["c1", "c2"] }] })).toEqual([["code"], ["order_id", "line_no"]]);
    expect(uniqueKeysOf({ columns: cols, constraints: [{ kind: "unique", columnIds: ["c4"] }, { kind: "check" }] })).toEqual([["code"], ["ref"]]);
    expect(uniqueKeysOf({ columns: cols, indexes: [{ unique: true, columns: [{ columnId: "c5" }] }, { unique: true, where: "deleted_at IS NULL", columns: [{ columnId: "c4" }] }, { unique: false, columns: [{ columnId: "c1" }] }] })).toEqual([["code"], ["email"]]);
  });
  it("決める列が無ければ undefined (定義が無いのと同じに扱う)", () => {
    expect(uniqueKeysOf({ columns: [{ id: "x", physicalName: "name" }] })).toBeUndefined();
  });
});
