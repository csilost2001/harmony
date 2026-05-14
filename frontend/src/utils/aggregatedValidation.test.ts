import { describe, it, expect } from "vitest";
import { aggregateValidation } from "./aggregatedValidation";
import type { ProcessFlow } from "../types/v3";

function makeGroup(partial: Partial<ProcessFlow>): ProcessFlow {
  return {
    meta: { id: "a", name: "x", kind: "screen", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    actions: [],
    ...partial,
  } as ProcessFlow;
}

describe("aggregateValidation — 統合テスト", () => {
  it("既存の structural error (loopBreak out of loop) を保持", () => {
    const errors = aggregateValidation(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{ id: "s1", kind: "loopBreak", description: "" }],
      }],
    }));
    expect(errors.some((e) => e.severity === "error")).toBe(true);
    expect(errors.some((e) => e.stepId === "s1")).toBe(true);
  });

  it("referentialIntegrity の UNKNOWN_RESPONSE_REF を取り込む", () => {
    const errors = aggregateValidation(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        responses: [{ id: "201", status: 201 }],
        steps: [{ id: "s1", kind: "return", description: "", responseId: "404-missing" }],
      }],
    }));
    const w = errors.find((e) => e.code === "UNKNOWN_RESPONSE_REF");
    expect(w).toBeDefined();
    expect(w?.severity).toBe("warning");
    expect(w?.stepId).toBe("s1");
    expect(w?.path).toBeDefined();
  });

  it("identifierScope の UNKNOWN_IDENTIFIER を取り込む", () => {
    const errors = aggregateValidation(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{ id: "s1", kind: "compute", description: "", expression: "@unknownX * 2", outputBinding: { name: "r" } }],
      }],
    }));
    const w = errors.find((e) => e.code === "UNKNOWN_IDENTIFIER");
    expect(w).toBeDefined();
    expect(w?.stepId).toBe("s1");
  });

  it("ネストした step (branch 内) の issue の stepId 解決", () => {
    const errors = aggregateValidation(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        responses: [{ id: "201", status: 201 }],
        steps: [{
          id: "branch1", kind: "branch", description: "",
          branches: [{
            id: "b1", code: "A", condition: { kind: "expression", expression: "@flag" },
            steps: [{ id: "inner-return", kind: "return", description: "", responseId: "missing" }],
          }],
        }],
      }],
    }));
    const w = errors.find((e) => e.code === "UNKNOWN_RESPONSE_REF");
    expect(w?.stepId).toBe("inner-return");
  });

  it("externalSystem.outcomes.sideEffects 内の step も stepId 解決", () => {
    const errors = aggregateValidation(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "ext", kind: "externalSystem", description: "", systemRef: "x",
          outcomes: {
            failure: {
              action: "continue",
              sideEffects: [{ id: "se-unknown", kind: "compute", description: "", expression: "@unknownVar", outputBinding: { name: "r" } }],
            },
          },
        }],
      }],
    }));
    const w = errors.find((e) => e.code === "UNKNOWN_IDENTIFIER");
    expect(w?.stepId).toBe("se-unknown");
  });

  it("UNKNOWN_SECRET_REF は catalog 階層なので stepId は空 ok", () => {
    const errors = aggregateValidation(makeGroup({
      context: { catalogs: {
        secrets: { k: { source: "env", name: "X" } },
        externalSystems: {
          stripe: { name: "Stripe", auth: { kind: "bearer", tokenRef: "@secret.unknown" } },
        },
      } },
      actions: [],
    }));
    const w = errors.find((e) => e.code === "UNKNOWN_SECRET_REF");
    expect(w).toBeDefined();
    expect(w?.path).toContain("context.catalogs.externalSystems");
  });

  it("options.tables / conventions 未指定時は SQL/conv 検査はスキップ", () => {
    // sql の列チェックは tables 未指定 → skip
    // conv 参照は conventions null/undefined → skip
    const errors = aggregateValidation(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        inputs: [{ name: "x", type: "number" }],
        steps: [{
          id: "s1", kind: "dbAccess", description: "",
          tableId: "unknown-table-id", operation: "SELECT",
          sql: "SELECT never_existing_col FROM unknown_table WHERE id = @x",
        }],
      }],
    }));
    // UNKNOWN_COLUMN は tables 未指定なので出ない
    expect(errors.every((e) => e.code !== "UNKNOWN_COLUMN")).toBe(true);
  });

  // ─── #1090: Generic Definition Catalog 参照整合性 ─────────────────────────────

  it("componentRef が catalog 内 → UNKNOWN_COMPONENT_REF が出ない", () => {
    const errors = aggregateValidation(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "s1", kind: "componentCall", description: "",
          componentRef: "generic-definitions/component-definition/OrderValidator",
          operation: "validate",
        }],
      }],
    }), {
      genericDefinitionNames: {
        "component-definition": new Set(["OrderValidator"]),
      },
    });
    expect(errors.every((e) => e.code !== "UNKNOWN_COMPONENT_REF")).toBe(true);
  });

  it("componentRef が catalog 外 → UNKNOWN_COMPONENT_REF (severity warning, stepId 解決)", () => {
    const errors = aggregateValidation(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "s1", kind: "componentCall", description: "",
          componentRef: "generic-definitions/component-definition/NonExistentValidator",
          operation: "validate",
        }],
      }],
    }), {
      genericDefinitionNames: {
        "component-definition": new Set(["OrderValidator"]),
      },
    });
    const w = errors.find((e) => e.code === "UNKNOWN_COMPONENT_REF");
    expect(w).toBeDefined();
    expect(w?.severity).toBe("warning");
    expect(w?.stepId).toBe("s1");
    expect(w?.path).toContain(".componentRef");
  });

  it("errorCatalog の exceptionTypeRef が catalog 外 → UNKNOWN_EXCEPTION_TYPE_REF (catalog レベル issue)", () => {
    const errors = aggregateValidation(makeGroup({
      context: {
        catalogs: {
          errors: {
            STOCK_SHORTAGE: {
              httpStatus: 422,
              defaultMessage: "在庫不足",
              exceptionTypeRef: "generic-definitions/exception-type/MissingException",
            },
          },
        },
      },
      actions: [],
    }), {
      genericDefinitionNames: {
        "exception-type": new Set(["StockInsufficientError"]),
      },
    });
    const w = errors.find((e) => e.code === "UNKNOWN_EXCEPTION_TYPE_REF");
    expect(w).toBeDefined();
    expect(w?.severity).toBe("warning");
    expect(w?.path).toContain("context.catalogs.errors.STOCK_SHORTAGE.exceptionTypeRef");
    // catalog レベルの issue は stepId 解決不能なので空文字
    expect(w?.stepId).toBe("");
  });

  it("ValidationStep.rules[].exceptionTypeRef が catalog 外 → UNKNOWN_EXCEPTION_TYPE_REF (stepId 解決)", () => {
    const errors = aggregateValidation(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "v1", kind: "validation", description: "",
          rules: [
            {
              field: "amount",
              type: "required",
              severity: "error",
              exceptionTypeRef: "generic-definitions/exception-type/UnknownErr",
            },
          ],
        }],
      }],
    }), {
      genericDefinitionNames: {
        "exception-type": new Set(["StockInsufficientError"]),
      },
    });
    const w = errors.find((e) => e.code === "UNKNOWN_EXCEPTION_TYPE_REF");
    expect(w).toBeDefined();
    expect(w?.severity).toBe("warning");
    expect(w?.stepId).toBe("v1");
    expect(w?.path).toContain(".rules[0].exceptionTypeRef");
  });

  it("genericDefinitionNames 未指定時は componentRef / exceptionTypeRef 検査をスキップ (silent pass)", () => {
    // 未指定時は catalog ロード失敗等を意味するため、誤検出を避ける目的で silent pass
    const errors = aggregateValidation(makeGroup({
      context: {
        catalogs: {
          errors: {
            ANY: {
              exceptionTypeRef: "generic-definitions/exception-type/Whatever",
            },
          },
        },
      },
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "s1", kind: "componentCall", description: "",
          componentRef: "generic-definitions/component-definition/Whatever",
          operation: "validate",
        }],
      }],
    }));
    // 上記いずれの ref code も出ない
    expect(errors.every((e) => e.code !== "UNKNOWN_COMPONENT_REF")).toBe(true);
    expect(errors.every((e) => e.code !== "UNKNOWN_EXCEPTION_TYPE_REF")).toBe(true);
  });

  it("componentRef / exceptionTypeRef が catalog 内 (正常 ref) → 全 ref code 出ない", () => {
    const errors = aggregateValidation(makeGroup({
      context: {
        catalogs: {
          errors: {
            STOCK_SHORTAGE: {
              httpStatus: 422,
              exceptionTypeRef: "generic-definitions/exception-type/StockInsufficientError",
            },
          },
        },
      },
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          {
            id: "s1", kind: "componentCall", description: "",
            componentRef: "generic-definitions/component-definition/OrderValidator",
            operation: "validate",
          },
          {
            id: "v1", kind: "validation", description: "",
            rules: [{
              field: "amount", type: "required", severity: "error",
              exceptionTypeRef: "generic-definitions/exception-type/StockInsufficientError",
            }],
          },
        ],
      }],
    }), {
      genericDefinitionNames: {
        "component-definition": new Set(["OrderValidator"]),
        "exception-type": new Set(["StockInsufficientError"]),
      },
    });
    expect(errors.every((e) => e.code !== "UNKNOWN_COMPONENT_REF")).toBe(true);
    expect(errors.every((e) => e.code !== "UNKNOWN_EXCEPTION_TYPE_REF")).toBe(true);
  });
});
