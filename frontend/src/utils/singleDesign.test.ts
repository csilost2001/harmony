import { describe, it, expect } from "vitest";
import { buildDesignDocument, type DesignDocInput } from "@harmony/shared";
import { inputForDesign, singleDesignFileStem, supportsSingleDesign } from "./singleDesign";

const input = {
  project: { id: "retail", name: "P" }, version: "1.0", generatedAt: "2026-10-17T00:00:00.000Z",
  screens: [{ id: "cart", name: "カート" }, { id: "top", name: "トップ" }],
  flows: [{ meta: { id: "f1", name: "注文確定" }, actions: [] }],
  tables: [{ id: "orders", name: "注文", physicalName: "orders", columns: [] }, { id: "items", name: "明細", physicalName: "items", columns: [] }],
  transitions: [{ sourceScreenId: "cart", targetScreenId: "top" }],
} as unknown as DesignDocInput;

describe("inputForDesign", () => {
  it("1 件だけに絞る。遷移は持たない", () => {
    const t = inputForDesign(input, "table", "orders")!;
    expect(t.tables.map((x) => x.id)).toEqual(["orders"]);
    expect(t.screens).toEqual([]);
    expect(t.transitions).toEqual([]);
    expect(inputForDesign(input, "screen", "cart")!.screens.map((x) => x.id)).toEqual(["cart"]);
    expect(inputForDesign(input, "processFlow", "f1")!.flows).toHaveLength(1);
  });
  it("見つからない・対象外の種類は null", () => {
    expect(inputForDesign(input, "table", "none")).toBeNull();
    expect(inputForDesign(input, "sequence", "x")).toBeNull();
    expect(supportsSingleDesign("sequence")).toBe(false);
    expect(supportsSingleDesign("table")).toBe(true);
  });
  it("設計書にできて、ほかの設計の名前は載らない", () => {
    const html = buildDesignDocument(inputForDesign(input, "table", "orders")!).html;
    expect(html).toContain("注文");
    expect(html).not.toContain("明細");
  });
});

describe("singleDesignFileStem", () => {
  it("英数字だけにする", () => {
    expect(singleDesignFileStem("retail", "table", "orders")).toBe("retail-table-orders");
    expect(singleDesignFileStem(undefined, "screen", "日本語")).toBe("harmony-screen-design");
  });
});
