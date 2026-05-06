import { describe, expect, it } from "vitest";
import type { View, ViewId, PhysicalName, Timestamp } from "../types/v3";
import { validateView } from "./viewValidation";

const ts = "2026-04-29T00:00:00.000Z" as Timestamp;

function view(overrides: Partial<View> = {}): View {
  return {
    id: "11111111-1111-4111-8111-111111111111" as ViewId,
    name: "顧客ビュー",
    physicalName: "v_customer" as PhysicalName,
    selectStatement: "SELECT customer_id FROM customers",
    outputColumns: [
      {
        physicalName: "customer_id" as PhysicalName,
        dataType: "varchar",
      },
    ],
    dependencies: [],
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

describe("validateView", () => {
  it("selectStatement empty → error", () => {
    const errors = validateView(view({ selectStatement: "  " }), []);

    expect(errors).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "view.selectStatement.empty",
      message: "SELECT 文が必須です",
    }));
  });

  it("outputColumns empty → warning", () => {
    const errors = validateView(view({ outputColumns: [] }), []);

    expect(errors).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "view.outputColumns.empty",
      message: "出力列が未定義です",
    }));
  });

  it("physicalName empty → error", () => {
    const errors = validateView(view({ physicalName: "  " as PhysicalName }), []);

    expect(errors).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "view.physicalName.empty",
      message: "物理名が必須です",
    }));
  });

  it("physicalName duplicate within same namespace → error", () => {
    const target = view();
    const duplicate = view({
      id: "22222222-2222-4222-8222-222222222222" as ViewId,
      name: "別ビュー",
    });

    const errors = validateView(target, [target, duplicate]);

    expect(errors).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "view.physicalName.duplicate",
      message: "物理名が重複しています",
    }));
  });

  it("displayName empty → warning", () => {
    const errors = validateView(view({ name: "  " }), []);

    expect(errors).toContainEqual(expect.objectContaining({
      severity: "warning",
      code: "view.displayName.empty",
      message: "表示名が未定義です",
    }));
  });

  it("valid view → no errors", () => {
    const target = view();

    expect(validateView(target, [target])).toEqual([]);
  });
});
