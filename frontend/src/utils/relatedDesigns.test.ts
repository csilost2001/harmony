import { describe, it, expect } from "vitest";
import { buildDesignGraph, type DesignDocInput } from "@harmony/shared";
import { graphKindOf, usesOf } from "./relatedDesigns";

const input = {
  project: { id: "p", name: "P" },
  screens: [{ id: "s1", name: "受注画面", items: [] }],
  flows: [{ meta: { id: "f1", name: "受注登録", screenId: "s1" }, actions: [{ id: "a", name: "登録", steps: [{ id: "x", kind: "dbAccess", tableId: "t1", operation: "INSERT" }] }] }],
  tables: [{ id: "t1", name: "受注", physicalName: "orders", columns: [] }],
} as unknown as DesignDocInput;

describe("usesOf (続編 第 6 弾 #113)", () => {
  it("処理フローが頼っている先 (テーブル・画面) を、種類ごとに返す", () => {
    const g = buildDesignGraph(input);
    const used = usesOf(g, "processFlow", "f1");
    expect(used.map((u) => `${u.kind}:${u.id}`)).toContain("table:t1");
    const table = used.find((u) => u.kind === "table")!;
    expect(table.name).toBe("受注");
    expect(table.route).toBe("/table/edit/t1");
    expect(table.how.length).toBeGreaterThan(0);
  });
  it("頼っている先が無ければ空 / 自分自身は含めない", () => {
    const g = buildDesignGraph(input);
    expect(usesOf(g, "table", "t1")).toEqual([]);
    expect(usesOf(g, "processFlow", "f1").some((u) => u.id === "f1")).toBe(false);
  });
  it("つながりを持つ種類だけ", () => {
    expect(graphKindOf("table")).toBe("table");
    expect(graphKindOf("sequence")).toBeNull();
    expect(graphKindOf("view")).toBeNull();
  });
});
