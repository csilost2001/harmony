import { describe, it, expect } from "vitest";
import type {
  ProcessFlow,
  HttpResponseSpec,
  ReturnStep,
  ComputeStep,
  ExternalSystemStep,
  OtherStep,
  LocalId,
  Description,
  Identifier,
  TemplateString,
} from "../types/v3";
import { STEP_TYPE_LABELS, STEP_TYPE_ICONS, STEP_TYPE_COLORS } from "../utils/processFlowMetadata";
import { migrateProcessFlow } from "../utils/actionMigration";

// #1355 Codex Must-fix: 各 Step literal は `const step: <Type> = {...}` で type 注釈し、
// brand のみ局所 cast。`({...} as unknown) as <Type>` のような outer-wrapping cast は
// excess property 検証を弱体化するため使わない。

describe("StepBase.runIf (#178)", () => {
  it("ステップに runIf を付与できる", () => {
    const step: ExternalSystemStep = {
      id: "s" as LocalId,
      kind: "externalSystem",
      description: "決済 authorize" as Description,
      systemRef: "Stripe" as ExternalSystemStep["systemRef"],
      runIf: "@paymentMethod == 'credit_card'" as TemplateString,
    };
    expect(step.runIf).toBe("@paymentMethod == 'credit_card'");
  });

  it("runIf は任意 (省略可能)", () => {
    const step: OtherStep = {
      id: "s" as LocalId,
      kind: "legacy:OtherStep",
      description: "" as Description,
    };
    expect(step.runIf).toBeUndefined();
  });

  it("全ステップタイプで runIf を付与できる (StepBaseProps 経由)", () => {
    // #1355 Codex Round 2 Must-fix: 各 kind の Step 型に個別注釈し、runIf field 自体は
    // StepBaseProps レベルで全 step 共通であることを smoke 検証する。
    // 旧 buildStub() で as unknown as Step していた箇所は StepBaseProps 経由に変更。
    const compute: ComputeStep = {
      id: "s" as LocalId,
      kind: "compute",
      description: "" as Description,
      expression: "1" as TemplateString,
      runIf: "@x > 0" as TemplateString,
    };
    const externalSystem: ExternalSystemStep = {
      id: "s" as LocalId,
      kind: "externalSystem",
      description: "" as Description,
      systemRef: "x" as Identifier,
      runIf: "@x > 0" as TemplateString,
    };
    const other: OtherStep = {
      id: "s" as LocalId,
      kind: "legacy:OtherStep",
      description: "" as Description,
      runIf: "@x > 0" as TemplateString,
    };
    // StepBaseProps を継承する全 step に runIf が付与可能であることを 3 種類の代表 step で確認
    [compute, externalSystem, other].forEach((step) => {
      expect(step.runIf).toBe("@x > 0");
    });
  });
});

describe("HttpResponseSpec.id (#178)", () => {
  it("id を付与して ReturnStep から参照可能にできる", () => {
    // #1355 Codex Round 2 Must-fix: v3 BodySchema は `{ typeRef: string } | { schema: ... }` の union object
    const spec: HttpResponseSpec = {
      id: "409-stock-shortage" as LocalId,
      status: 409,
      bodySchema: { typeRef: "ApiError" },
      description: "在庫不足" as Description,
    };
    expect(spec.id).toBe("409-stock-shortage");
  });

  it("v3: id は required field (v1 から rename、optional → required 化)", () => {
    // v3 schema 上 HttpResponseSpec.id は required。v1 では optional だったが #178 で required 化。
    const spec: HttpResponseSpec = {
      id: "201" as LocalId,
      status: 201,
    };
    expect(spec.id).toBe("201");
  });
});

describe("ReturnStep (#178)", () => {
  it("responseId + bodyExpression で返却を構造化できる (v3: responseRef → responseId rename)", () => {
    // #1355 Codex Must-fix: v3 schema 上 ReturnStep の field は `responseId` (旧 `responseRef`)
    const step: ReturnStep = {
      id: "s-ret" as LocalId,
      kind: "return",
      description: "在庫不足レスポンス" as Description,
      responseId: "409-stock-shortage" as LocalId,
      bodyExpression: "{ code: 'STOCK_SHORTAGE', detail: @shortageList }" as TemplateString,
    };
    expect(step.kind).toBe("return");
    expect(step.responseId).toBe("409-stock-shortage");
    expect(step.bodyExpression).toContain("@shortageList");
  });

  it("responseId / bodyExpression は任意", () => {
    const step: ReturnStep = {
      id: "s" as LocalId,
      kind: "return",
      description: "" as Description,
    };
    expect(step.responseId).toBeUndefined();
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
    // raw は v1 legacy shape (type 等)、migration が v3 に変換する
    const raw: unknown = {
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

  it("ReturnStep を冪等にマイグレーションできる (v1 responseRef → v3 では legacy field 保持)", () => {
    // raw は v1 legacy shape。migration は unknown field を保持するため、
    // v1 の responseRef は v3 ReturnStep 型にはないが、runtime 値としては残る。
    const raw: unknown = {
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
    // v1 legacy field `responseRef` は v3 ReturnStep 型から削除済 (responseId に rename)、
    // ただし migration は unknown 値を保持するため runtime では参照可能。
    // 型 narrow を bypass して Record アクセス (legacy 専用)。
    expect((step as unknown as Record<string, unknown>).responseRef).toBe("409-stock-shortage");
    expect(step.maturity).toBe("draft");

    expect(once.actions[0].responses?.[0].id).toBe("409-stock-shortage");
  });
});
