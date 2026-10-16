import { describe, it, expect } from "vitest";
import { computeRowMarks } from "./rowMarks";

const rows = [
  { id: "orders", name: "受注" },
  { id: "orders-2", name: "受注" },
  { id: "Customers", name: "顧客" },
  { id: "ok", name: "正常" },
  { id: "empty-name", name: "" },
];
const marks = computeRowMarks(rows, (r) => r.id, (r) => r.name);

describe("computeRowMarks (続編 第 6 弾 #118)", () => {
  it("名前が重なる行に、理由を付ける", () => {
    expect(marks.get("orders")).toContain("同じ名前の設計が他に 1 件");
    expect(marks.get("orders-2")).toContain("同じ名前の設計が他に 1 件");
  });
  it("ID が規約の形式でない行に、理由を付ける", () => {
    expect(marks.get("Customers")).toContain("ID「Customers」");
  });
  it("問題の無い行・名前が空の行には付けない", () => {
    expect(marks.has("ok")).toBe(false);
    expect(marks.has("empty-name")).toBe(false);
  });
  it("全角半角・大文字小文字の違いは同じ名前として数える", () => {
    const m = computeRowMarks([{ id: "a", name: "ＡＢＣ" }, { id: "b", name: "abc" }], (r) => r.id, (r) => r.name);
    expect([...m.keys()].sort()).toEqual(["a", "b"]);
  });
});
