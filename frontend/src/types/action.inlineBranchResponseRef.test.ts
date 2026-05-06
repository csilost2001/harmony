import { describe, it, expect } from "vitest";
import type { ProcessFlow, ValidationStep } from "./action";
import { migrateProcessFlow } from "../utils/actionMigration";

describe("ValidationStep.inlineBranch.ngResponseRef (#180)", () => {
  it("NG 時のレスポンス参照と body 式を保持できる", () => {
    const step: ValidationStep = {
      id: "s",
      type: "validation",
      description: "",
      conditions: "",
      rules: [{ field: "x", type: "required" }],
      inlineBranch: {
        ok: "次へ",
        ng: "400 VALIDATION で return",
        ngResponseRef: "400-validation",
        ngBodyExpression: "{ code: 'VALIDATION', fieldErrors: @fieldErrors }",
      },
    };
    expect(step.inlineBranch?.ngResponseRef).toBe("400-validation");
    expect(step.inlineBranch?.ngBodyExpression).toContain("fieldErrors");
  });

  it("ngResponseRef / ngBodyExpression は任意 (既存データ互換)", () => {
    const step: ValidationStep = {
      id: "s",
      type: "validation",
      description: "",
      conditions: "",
      inlineBranch: { ok: "OK", ng: "NG" },
    };
    expect(step.inlineBranch?.ngResponseRef).toBeUndefined();
    expect(step.inlineBranch?.ngBodyExpression).toBeUndefined();
  });

  it("migrateProcessFlow で冪等保持", () => {
    const raw = {
      id: "g", name: "x", type: "screen", description: "",
      actions: [{
        id: "a", name: "a", trigger: "submit",
        responses: [{ id: "400-validation", status: 400, bodySchema: "ApiError" }],
        steps: [{
          id: "s", type: "validation", description: "",
          conditions: "",
          rules: [{ field: "x", type: "required" }],
          inlineBranch: {
            ok: "next",
            ng: "error",
            ngResponseRef: "400-validation",
            ngBodyExpression: "{ code: 'VALIDATION' }",
          },
        }],
      }],
      createdAt: "", updatedAt: "",
    };
    const once = migrateProcessFlow(raw) as ProcessFlow;
    const twice = migrateProcessFlow(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    const step = once.actions[0].steps[0] as ValidationStep;
    expect(step.inlineBranch?.ngResponseRef).toBe("400-validation");
  });
});
