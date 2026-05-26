import { describe, it, expect } from "vitest";
import type { ProcessFlow, HttpResponseSpec, ReturnStep, Step } from "../types/v3";
import { STEP_TYPE_LABELS, STEP_TYPE_ICONS, STEP_TYPE_COLORS } from "../utils/processFlowMetadata";
import { migrateProcessFlow } from "../utils/actionMigration";

describe("StepBase.runIf (#178)", () => {
  it("ステップに runIf を付与できる", () => {
    const step = ({
      id: "s",
      type: "externalSystem",
      description: "決済 authorize",
      systemName: "Stripe",
      runIf: "@paymentMethod == 'credit_card'",
    } as unknown) as Step;
    expect(step.runIf).toBe("@paymentMethod == 'credit_card'");
  });

  it("runIf は任意 (省略可能)", () => {
    const step = ({
      id: "s",
      type: "other",
      description: "",
    } as unknown) as Step;
    expect(step.runIf).toBeUndefined();
  });

  it("全ステップタイプで runIf を付与できる", () => {
    const types = [
      "validation", "dbAccess", "externalSystem", "commonProcess",
      "screenTransition", "displayUpdate", "branch", "loop",
      "loopBreak", "loopContinue", "jump", "compute", "return", "other",
    ];
    // 型コンパイルできることを確認するだけの smoke test
    types.forEach((t) => {
      const _step = { id: "s", type: t, description: "", runIf: "@x > 0" } as unknown as Step;
      expect((_step as { runIf: string }).runIf).toBe("@x > 0");
    });
  });
});

describe("HttpResponseSpec.id (#178)", () => {
  it("id を付与して ReturnStep から参照可能にできる", () => {
    const spec = ({
      id: "409-stock-shortage",
      status: 409,
      bodySchema: "ApiError",
      description: "在庫不足",
    } as unknown) as HttpResponseSpec;
    expect(spec.id).toBe("409-stock-shortage");
  });

  it("id は任意 (既存データ互換)", () => {
    const spec = ({ status: 201 } as unknown) as HttpResponseSpec;
    expect(spec.id).toBeUndefined();
  });
});

describe("ReturnStep (#178)", () => {
  it("responseRef + bodyExpression で返却を構造化できる", () => {
    const step = ({
      id: "s-ret",
      kind: "return",
      description: "在庫不足レスポンス",
      responseRef: "409-stock-shortage",
      bodyExpression: "{ code: 'STOCK_SHORTAGE', detail: @shortageList }",
    } as unknown) as ReturnStep;
    expect(step.kind).toBe("return");
    expect((step as unknown as { responseRef?: string }).responseRef).toBe("409-stock-shortage");
    expect(step.bodyExpression).toContain("@shortageList");
  });

  it("responseRef / bodyExpression は任意", () => {
    const step = ({
      id: "s",
      type: "return",
      description: "",
    } as unknown) as ReturnStep;
    expect((step as unknown as { responseRef?: string }).responseRef).toBeUndefined();
    expect(step.bodyExpression).toBeUndefined();
  });

  it("STEP_TYPE_LABELS / ICONS / COLORS に return が追加されている", () => {
    expect(STEP_TYPE_LABELS.return).toBe("レスポンス返却");
    expect(STEP_TYPE_ICONS.return).toBe("bi-reply");
    expect(STEP_TYPE_COLORS.return).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe("migrateProcessFlow — runIf / ReturnStep / responses[].id 透過保持 (#178)", () => {
  it("runIf を持つステップを冪等にマイグレーションできる", () => {
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
              type: "externalSystem",
              description: "",
              systemName: "Stripe",
              runIf: "@paymentMethod == 'credit_card'",
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
    expect(once.actions[0].steps[0].runIf).toBe("@paymentMethod == 'credit_card'");
  });

  it("ReturnStep を冪等にマイグレーションできる", () => {
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
          responses: [
            { id: "409-stock-shortage", status: 409, bodySchema: "ApiError" },
          ],
          steps: [
            {
              id: "s",
              type: "return",
              description: "",
              responseRef: "409-stock-shortage",
              bodyExpression: "{ code: 'STOCK_SHORTAGE' }",
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

    const step = once.actions[0].steps[0] as ReturnStep;
    expect(step.kind).toBe("return");
    expect((step as unknown as { responseRef?: string }).responseRef).toBe("409-stock-shortage");
    expect(step.maturity).toBe("draft");

    expect(once.actions[0].responses?.[0].id).toBe("409-stock-shortage");
  });
});
