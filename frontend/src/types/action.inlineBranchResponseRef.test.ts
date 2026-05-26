import { describe, it, expect } from "vitest";
import type {
  ProcessFlow,
  ValidationStep,
  ValidationInlineBranch,
  LocalId,
  Description,
  Identifier,
  TemplateString,
} from "../types/v3";
import { migrateProcessFlow } from "../utils/actionMigration";

// #1355 Codex Must-fix: type 注釈で type shape を検証、brand のみ局所 cast。
// v3: ngResponseRef → ngResponseId rename、ok/ng は Step[] (v1 では string)。

describe("ValidationStep.inlineBranch.ngResponseId (#180、旧 ngResponseRef)", () => {
  it("NG 時のレスポンス参照と body 式を保持できる", () => {
    const inlineBranch: ValidationInlineBranch = {
      ok: [],
      ng: [],
      ngResponseId: "400-validation" as LocalId,
      ngBodyExpression: "{ code: 'VALIDATION', fieldErrors: @fieldErrors }" as TemplateString,
    };
    const step: ValidationStep = {
      id: "s" as LocalId,
      kind: "validation",
      description: "" as Description,
      conditions: "",
      rules: [{ field: "x" as Identifier, type: "required" }],
      fieldErrorsVar: "fieldErrors" as Identifier,
      inlineBranch,
    };
    expect(step.inlineBranch?.ngResponseId).toBe("400-validation");
    expect(step.inlineBranch?.ngBodyExpression).toContain("fieldErrors");
  });

  it("ngResponseId / ngBodyExpression は任意 (既存データ互換)", () => {
    const step: ValidationStep = {
      id: "s" as LocalId,
      kind: "validation",
      description: "" as Description,
      conditions: "",
      fieldErrorsVar: "fieldErrors" as Identifier,
      inlineBranch: { ok: [], ng: [] },
    };
    expect(step.inlineBranch?.ngResponseId).toBeUndefined();
    expect(step.inlineBranch?.ngBodyExpression).toBeUndefined();
  });

  it("migrateProcessFlow で冪等保持 (v1 legacy ngResponseRef は v3 でも runtime 値として保持)", () => {
    const raw: unknown = {
      id: "g", name: "x", type: "screen", description: "",
      actions: [{
        id: "a", name: "a", trigger: "submit",
        responses: [{ id: "400-validation", status: 400, bodySchema: "ApiError" }],
        steps: [{
          id: "s", type: "validation", description: "",
          conditions: "",
          rules: [{ field: "x", type: "required" }],
          fieldErrorsVar: "fieldErrors",
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
    // legacy ngResponseRef field は v3 ValidationInlineBranch 型から削除済 (ngResponseId に rename)、
    // 但し migration は unknown 値を保持するため runtime では参照可能 (legacy 専用 Record アクセス)。
    expect((step.inlineBranch as unknown as Record<string, unknown> | undefined)?.ngResponseRef).toBe("400-validation");
  });
});
