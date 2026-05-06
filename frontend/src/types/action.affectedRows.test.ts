import { describe, it, expect } from "vitest";
import type { ProcessFlow, AffectedRowsCheck, DbAccessStep } from "./action";
import { migrateProcessFlow } from "../utils/actionMigration";

describe("DbAccessStep の affectedRowsCheck (#164)", () => {
  it("在庫引当の条件付き UPDATE + throw パターンを表現できる", () => {
    const check: AffectedRowsCheck = {
      operator: ">",
      expected: 0,
      onViolation: "throw",
      errorCode: "STOCK_SHORTAGE",
      description: "在庫不足 (並行引当)",
    };
    const step: DbAccessStep = {
      id: "s",
      type: "dbAccess",
      description: "在庫引当",
      tableName: "inventory",
      operation: "UPDATE",
      fields: "SET stock = stock - @qty WHERE item_id = @id AND stock >= @qty",
      affectedRowsCheck: check,
    };
    expect(step.affectedRowsCheck?.operator).toBe(">");
    expect(step.affectedRowsCheck?.expected).toBe(0);
    expect(step.affectedRowsCheck?.onViolation).toBe("throw");
    expect(step.affectedRowsCheck?.errorCode).toBe("STOCK_SHORTAGE");
  });

  it("onViolation の 4 値 (throw / abort / log / continue) を許容", () => {
    const patterns = (["throw", "abort", "log", "continue"] as const).map((v) => ({
      operator: "=" as const,
      expected: 1,
      onViolation: v,
    }));
    patterns.forEach((p) => {
      const step: DbAccessStep = {
        id: "s", type: "dbAccess", description: "",
        tableName: "x", operation: "DELETE",
        affectedRowsCheck: p,
      };
      expect(step.affectedRowsCheck?.onViolation).toBe(p.onViolation);
    });
  });

  it("operator の 5 値 (>, >=, =, <, <=) を許容", () => {
    const ops: AffectedRowsCheck["operator"][] = [">", ">=", "=", "<", "<="];
    ops.forEach((op) => {
      const step: DbAccessStep = {
        id: "s", type: "dbAccess", description: "",
        tableName: "x", operation: "UPDATE",
        affectedRowsCheck: { operator: op, expected: 1, onViolation: "throw" },
      };
      expect(step.affectedRowsCheck?.operator).toBe(op);
    });
  });

  it("省略可能 (既存データ互換)", () => {
    const step: DbAccessStep = {
      id: "s", type: "dbAccess", description: "",
      tableName: "x", operation: "SELECT",
    };
    expect(step.affectedRowsCheck).toBeUndefined();
  });
});

describe("migrateProcessFlow — affectedRowsCheck 透過保持 (#164)", () => {
  it("新フィールドを持つ DbAccessStep を冪等にマイグレーションできる", () => {
    const raw = {
      id: "g", name: "x", type: "screen", description: "",
      actions: [{
        id: "a", name: "a", trigger: "submit",
        steps: [{
          id: "s", type: "dbAccess", description: "",
          tableName: "inventory", operation: "UPDATE",
          fields: "SET stock = stock - @q WHERE stock >= @q",
          affectedRowsCheck: {
            operator: ">", expected: 0,
            onViolation: "throw", errorCode: "STOCK_SHORTAGE",
          },
        }],
      }],
      createdAt: "", updatedAt: "",
    };
    const once = migrateProcessFlow(raw) as ProcessFlow;
    const twice = migrateProcessFlow(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    const step = once.actions[0].steps[0] as DbAccessStep;
    expect(step.affectedRowsCheck?.errorCode).toBe("STOCK_SHORTAGE");
  });

  it("新フィールドなしの旧データでも破壊なし", () => {
    const raw = {
      id: "g", name: "x", type: "screen", description: "",
      actions: [{
        id: "a", name: "a", trigger: "click",
        steps: [{ id: "s", type: "dbAccess", description: "", tableName: "x", operation: "SELECT" }],
      }],
      createdAt: "", updatedAt: "",
    };
    const migrated = migrateProcessFlow(raw) as ProcessFlow;
    const step = migrated.actions[0].steps[0] as DbAccessStep;
    expect(step.affectedRowsCheck).toBeUndefined();
  });
});
