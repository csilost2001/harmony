import { describe, it, expect } from "vitest";
import { findNode, type LayoutNode } from "@harmony/shared";
import { createNode, dataTypeToFieldType, docDuplicate, docRemove, itemFromColumn, nextItemId, nodeTypeForItem, toCamel } from "./layoutModel";
import { insertionIndex } from "./layoutDnd";
import type { ScreenItem } from "../../types/v3/screen-item";
import type { Table, Column } from "../../types/v3/table";

const item = (id: string, extra: Partial<ScreenItem> = {}): ScreenItem => ({ id, label: id, type: "string", ...extra } as ScreenItem);

describe("テーブル列 → 画面項目", () => {
  const table = { id: "store-master", name: "店舗マスタ", physicalName: "stores", columns: [] } as unknown as Table;
  const col = (c: Partial<Column>) => ({ id: "c1", physicalName: "store_name", name: "店舗名", dataType: "VARCHAR", ...c } as Column);

  it("型・桁・必須・表示名・DB 列参照を引き継ぐ", () => {
    const it = itemFromColumn(table, col({ length: 100, notNull: true }), []);
    expect(it).toMatchObject({ id: "storeName", label: "店舗名", type: "string", direction: "in", required: true, maxLength: 100, binding: { kind: "tableColumn", ref: { tableId: "store-master", columnId: "c1" } } });
  });
  it("自動採番・既定値ありの列は必須にしない", () => {
    expect(itemFromColumn(table, col({ notNull: true, autoIncrement: true }), []).required).toBeUndefined();
    expect(itemFromColumn(table, col({ notNull: true, defaultValue: "now()" }), []).required).toBeUndefined();
  });
  it("既存項目と ID が重なれば連番を付ける", () => {
    expect(itemFromColumn(table, col({}), [item("storeName")]).id).toBe("storeName2");
  });
  it("DB 型の対応", () => {
    expect(dataTypeToFieldType("BIGINT")).toBe("integer");
    expect(dataTypeToFieldType("DECIMAL")).toBe("number");
    expect(dataTypeToFieldType("TIMESTAMP")).toBe("datetime");
    expect(dataTypeToFieldType("DATE")).toBe("date");
    expect(dataTypeToFieldType("BOOLEAN")).toBe("boolean");
    expect(dataTypeToFieldType("CHAR")).toBe("string");
  });
});

describe("部品と項目の操作", () => {
  const nodes: LayoutNode[] = [
    { id: "form", type: "form", children: [{ id: "name", type: "field", itemRef: "name" }, { id: "name2", type: "field", itemRef: "shared" }] },
    { id: "other", type: "field", itemRef: "shared" },
  ];
  const doc = { items: [item("name"), item("shared")], layout: { version: 1 as const, nodes } };

  it("削除した部品だけが参照していた項目は一緒に消し、共有項目は残す", () => {
    const { doc: next, removedItemIds } = docRemove(doc, "form", true);
    expect(removedItemIds).toEqual(["name"]);
    expect(next.items.map((i) => i.id)).toEqual(["shared"]);
    expect(findNode(next.layout!.nodes, "other")).not.toBeNull();
  });

  it("複製すると項目も複製し、直後に置く", () => {
    const { doc: next, newId } = docDuplicate(doc, "form");
    expect(newId).toBe("form2");
    expect(next.layout!.nodes.map((n) => n.id)).toEqual(["form", "form2", "other"]);
    const copied = findNode(next.layout!.nodes, "form2")!;
    expect(copied.children?.map((c) => c.itemRef)).toEqual(["name2", "shared2"]);
    expect(next.items.find((i) => i.id === "name2")?.label).toBe("name (複製)");
  });

  it("容器の部品は子を持つ初期形で作る", () => {
    const cols = createNode("columns", []);
    expect(cols.children?.map((c) => c.type)).toEqual(["column", "column"]);
    expect(createNode("tabs", []).children?.[0].type).toBe("tab");
  });

  it("項目の種類から置く部品を決める", () => {
    expect(nodeTypeForItem(item("rows", { presentation: { kind: "table" } } as Partial<ScreenItem>))).toBe("table");
    expect(nodeTypeForItem(item("x", { type: { kind: "array", itemType: "string" } } as Partial<ScreenItem>))).toBe("table");
    expect(nodeTypeForItem(item("b", { type: "retail:button" } as unknown as Partial<ScreenItem>))).toBe("button");
    expect(nodeTypeForItem(item("y"))).toBe("field");
  });

  it("ID 生成", () => {
    expect(toCamel("store_name")).toBe("storeName");
    expect(nextItemId([item("rows")], "rows")).toBe("rows2");
  });
});

describe("insertionIndex", () => {
  const rect = (left: number, top: number) => ({ left, top, width: 100, height: 40 });
  it("縦並び: ポインタより下にある最初の要素の前", () => {
    const rects = [rect(0, 0), rect(0, 50), rect(0, 100)];
    expect(insertionIndex(rects, 50, -5)).toBe(0);
    expect(insertionIndex(rects, 50, 70)).toBe(2);
    expect(insertionIndex(rects, 50, 500)).toBe(3);
  });
  it("横並び (グリッド): 同じ行では左右で判定", () => {
    const rects = [rect(0, 0), rect(120, 0), rect(0, 50)];
    expect(insertionIndex(rects, 10, 20)).toBe(0);
    expect(insertionIndex(rects, 150, 20)).toBe(1);
    expect(insertionIndex(rects, 200, 20)).toBe(2);
  });
});
