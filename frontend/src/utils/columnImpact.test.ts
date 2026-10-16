import { describe, it, expect } from "vitest";
import { analyzeImpact, buildDesignGraph, type DesignDocInput } from "@harmony/shared";
import type { Column } from "../types/v3";
import { changedColumns, summarizeImpact } from "./columnImpact";

const col = (id: string, extra: Record<string, unknown> = {}) => ({ id, physicalName: id, name: id, dataType: "VARCHAR", length: 20, ...extra }) as unknown as Column;

describe("changedColumns (続編 第 8 弾 #152)", () => {
  const base = [col("a"), col("b", { dataType: "INTEGER", length: undefined }), col("c", { notNull: true }), col("d")];
  it("型・桁・NOT NULL の変更と、削除を集める", () => {
    const now = [col("a", { length: 50 }), col("b", { dataType: "BIGINT", length: undefined }), col("c", { notNull: false }), col("e")];
    const r = changedColumns(base, now);
    expect(r.map((x) => [x.columnId, x.deleted])).toEqual([["a", false], ["b", false], ["c", false], ["d", true]]);
    expect(r[0].changes).toEqual(["型 VARCHAR(20) → VARCHAR(50)"]);
    expect(r[1].changes).toEqual(["型 INTEGER → BIGINT"]);
    expect(r[2].changes).toEqual(["NOT NULL あり → なし"]);
    expect(r[3].changes).toEqual(["削除"]);
  });
  it("変えていない列・追加した列・基準が無いときは空", () => {
    expect(changedColumns(base, base)).toEqual([]);
    expect(changedColumns(base, [...base, col("new")])).toEqual([]);
    expect(changedColumns(undefined, base)).toEqual([]);
  });
});

describe("summarizeImpact", () => {
  it("影響分析の結果を、種類ごとの件数と、名前にまとめる", () => {
    const input = {
      project: { id: "p", name: "P" },
      screens: [{ id: "s1", name: "受注画面", items: [] }],
      flows: [{ meta: { id: "f1", name: "受注登録", screenId: "s1" }, actions: [{ id: "a", name: "登録", steps: [{ id: "x", kind: "dbAccess", tableId: "t1", operation: "INSERT" }] }] }],
      tables: [{ id: "t1", name: "受注", physicalName: "orders", columns: [] }],
    } as unknown as DesignDocInput;
    const r = analyzeImpact(input, "table", "t1", {}, buildDesignGraph(input));
    const s = summarizeImpact(r);
    expect(s.total).toBe(r.total);
    expect(s.total).toBeGreaterThan(0);
    expect(s.names.some((n) => n.kind === "processFlow")).toBe(true);
    expect(summarizeImpact(null)).toEqual({ total: 0, byKind: [], names: [] });
  });
});
