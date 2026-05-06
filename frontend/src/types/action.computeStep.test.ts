import { describe, it, expect } from "vitest";
import type { ProcessFlow, ComputeStep, Step } from "./action";
import { STEP_TYPE_LABELS, STEP_TYPE_ICONS, STEP_TYPE_COLORS } from "./action";
import { migrateProcessFlow } from "../utils/actionMigration";

describe("ComputeStep (#174)", () => {
  it("税額計算の典型パターンを表現できる", () => {
    const step: ComputeStep = {
      id: "s-tax",
      kind: "compute",
      description: "税額計算 (外税 10% 切り捨て)",
      expression: "Math.floor(@subtotal * 0.10)",
      outputBinding: "taxAmount",
    };
    expect(step.kind).toBe("compute");
    expect(step.expression).toBe("Math.floor(@subtotal * 0.10)");
    expect(step.outputBinding).toBe("taxAmount");
  });

  it("合計算出のパターン", () => {
    const step: ComputeStep = {
      id: "s-total",
      type: "compute",
      description: "合計金額",
      expression: "@subtotal + @taxAmount",
      outputBinding: "totalAmount",
    };
    expect(step.expression).toContain("@subtotal");
    expect(step.expression).toContain("@taxAmount");
  });

  it("構造化 outputBinding と組合せできる", () => {
    const step: ComputeStep = {
      id: "s",
      type: "compute",
      description: "カウント",
      expression: "@items.length",
      outputBinding: { name: "itemCount", operation: "assign" },
    };
    expect(step.outputBinding).toEqual({ name: "itemCount", operation: "assign" });
  });

  it("STEP_TYPE_LABELS / ICONS / COLORS に compute が追加されている", () => {
    expect(STEP_TYPE_LABELS.compute).toBe("計算/代入");
    expect(STEP_TYPE_ICONS.compute).toBe("bi-calculator");
    expect(STEP_TYPE_COLORS.compute).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("migrateProcessFlow — ComputeStep 透過保持 (#174)", () => {
  it("ComputeStep を冪等にマイグレーションできる", () => {
    const raw = {
      id: "g",
      name: "x",
      type: "screen",
      description: "",
      actions: [
        {
          id: "a",
          name: "a",
          trigger: "submit",
          steps: [
            {
              id: "s",
              type: "compute",
              description: "税額",
              expression: "Math.floor(@subtotal * 0.10)",
              outputBinding: "taxAmount",
            },
          ],
        },
      ],
      createdAt: "",
      updatedAt: "",
    };
    const once = migrateProcessFlow(raw) as ProcessFlow;
    const twice = migrateProcessFlow(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    const step = once.actions[0].steps[0] as ComputeStep;
    expect(step.kind).toBe("compute");
    expect(step.expression).toBe("Math.floor(@subtotal * 0.10)");
    // maturity 既定が付与される
    expect(step.maturity).toBe("draft");
  });

  it("ComputeStep を branch の elseBranch に入れても再帰マイグレーションされる", () => {
    const raw = {
      id: "g",
      name: "x",
      type: "screen",
      description: "",
      actions: [
        {
          id: "a",
          name: "a",
          trigger: "submit",
          steps: [
            {
              id: "br",
              type: "branch",
              description: "",
              branches: [{ id: "b1", code: "A", condition: "", steps: [] }],
              elseBranch: {
                id: "be",
                code: "ELSE",
                condition: "",
                steps: [
                  { id: "c", type: "compute", description: "", expression: "@a + @b", outputBinding: "sum" },
                ],
              },
            },
          ],
        },
      ],
      createdAt: "",
      updatedAt: "",
    };
    const migrated = migrateProcessFlow(raw) as ProcessFlow;
    const br = migrated.actions[0].steps[0] as unknown as {
      elseBranch: { steps: Step[] };
    };
    const compute = br.elseBranch.steps[0] as ComputeStep;
    expect(compute.kind).toBe("compute");
    expect(compute.maturity).toBe("draft");
  });
});
