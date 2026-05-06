import { describe, it, expect } from "vitest";
import { checkReferentialIntegrity } from "./referentialIntegrity";
import { loadExtensionsFromBundle } from "./loadExtensions";
import type { ProcessFlow } from "../types/action";

function makeGroup(partial: Partial<ProcessFlow>): ProcessFlow {
  return {
    meta: { id: "a", name: "x", kind: "screen", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    actions: [],
    ...partial,
  } as ProcessFlow;
}

describe("checkReferentialIntegrity — responseRef", () => {
  it("未定義 responseId を検出", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        responses: [{ id: "201-ok", status: 201 }],
        steps: [
          { id: "s1", kind: "return", description: "", responseId: "999-missing" },
        ],
      }],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("UNKNOWN_RESPONSE_REF");
    expect(issues[0].value).toBe("999-missing");
  });

  it("定義済み responseId は問題なし", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        responses: [{ id: "201-ok", status: 201 }],
        steps: [{ id: "s1", kind: "return", description: "", responseId: "201-ok" }],
      }],
    }));
    expect(issues).toHaveLength(0);
  });

  it("ValidationStep.inlineBranch.ngResponseId も検査", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        responses: [],
        steps: [{
          id: "s1", kind: "validation", description: "", conditions: "",
          inlineBranch: { ok: [], ng: [], ngResponseId: "400-not-defined" },
        }],
      }],
    }));
    expect(issues.some((i) => i.code === "UNKNOWN_RESPONSE_REF")).toBe(true);
  });

  it("errorCatalog.responseId も検査", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      context: { catalogs: { errors: {
        STOCK_SHORTAGE: { responseId: "409-missing" },
      } } },
      actions: [{
        id: "a1", name: "f", trigger: "click",
        responses: [{ id: "409-stock-shortage", status: 409 }],
        steps: [],
      }],
    }));
    expect(issues.some((i) => i.code === "UNKNOWN_RESPONSE_REF")).toBe(true);
  });
});

describe("checkReferentialIntegrity — errorCode", () => {
  it("errorCatalog 定義時、未登録 errorCode を検出", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      context: { catalogs: { errors: { STOCK_SHORTAGE: { httpStatus: 409 } } } },
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "s1", kind: "dbAccess", description: "",
          tableId: "t", operation: "UPDATE",
          affectedRowsCheck: { operator: ">", expected: 0, onViolation: "throw", errorCode: "UNKNOWN_CODE" },
        }],
      }],
    }));
    expect(issues.some((i) => i.code === "UNKNOWN_ERROR_CODE")).toBe(true);
  });

  it("errorCatalog 未定義時は errorCode 検査をスキップ (後方互換)", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "s1", kind: "dbAccess", description: "",
          tableId: "t", operation: "UPDATE",
          affectedRowsCheck: { operator: ">", expected: 0, onViolation: "throw", errorCode: "ANY" },
        }],
      }],
    }));
    expect(issues).toHaveLength(0);
  });

  it("BranchConditionVariant.errorCode も検査", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      context: { catalogs: { errors: { STOCK_SHORTAGE: {} } } },
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "s1", kind: "branch", description: "",
          branches: [{
            id: "b1", code: "A",
            condition: { kind: "tryCatch", errorCode: "NOT_REGISTERED" },
            steps: [],
          }],
        }],
      }],
    }));
    expect(issues.some((i) => i.code === "UNKNOWN_ERROR_CODE")).toBe(true);
  });
});

describe("checkReferentialIntegrity — ネスト走査", () => {
  it("loop.steps 内の ReturnStep も検査", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        responses: [{ id: "200-ok", status: 200 }],
        steps: [{
          id: "lp", kind: "loop", description: "", loopKind: "count",
          steps: [{ id: "ret", kind: "return", description: "", responseId: "missing" }],
        }],
      }],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toContain("steps[0].steps[0]");
  });

  it("externalSystem.outcomes.sideEffects 内も検査", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        responses: [],
        steps: [{
          id: "ext", kind: "externalSystem", description: "", systemRef: "s",
          outcomes: {
            failure: {
              action: "continue",
              sideEffects: [
                { id: "ret", kind: "return", description: "", responseId: "missing" },
              ],
            },
          },
        }],
      }],
    }));
    expect(issues.some((i) => i.path.includes("sideEffects"))).toBe(true);
  });
});

describe("checkReferentialIntegrity — @secret.* (#261 v1.6)", () => {
  it("secretsCatalog 定義時、未登録 @secret を検出", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      context: { catalogs: {
        secrets: { stripeKey: { source: "env", name: "STRIPE_SECRET_KEY" } },
        externalSystems: {
          stripe: { name: "Stripe", auth: { kind: "bearer", tokenRef: "@secret.unknown" } },
        },
      } },
      actions: [],
    }));
    expect(issues.some((i) => i.code === "UNKNOWN_SECRET_REF")).toBe(true);
  });

  it("catalog にある @secret は OK", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      context: { catalogs: {
        secrets: { stripeKey: { source: "env", name: "STRIPE_SECRET_KEY" } },
        externalSystems: {
          stripe: { name: "Stripe", auth: { kind: "bearer", tokenRef: "@secret.stripeKey" } },
        },
      } },
      actions: [],
    }));
    expect(issues).toHaveLength(0);
  });

  it("step 側 auth.tokenRef の @secret も検査", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      context: { catalogs: { secrets: { stripeKey: { source: "env", name: "STRIPE_SECRET_KEY" } } } },
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "s1", kind: "externalSystem", description: "",
          systemRef: "stripe",
          auth: { kind: "bearer", tokenRef: "@secret.unknownKey" },
        }],
      }],
    }));
    expect(issues.some((i) => i.code === "UNKNOWN_SECRET_REF")).toBe(true);
  });

  it("secretsCatalog 未定義時は @secret 検査をスキップ (後方互換)", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      context: { catalogs: { externalSystems: {
        stripe: { name: "Stripe", auth: { kind: "bearer", tokenRef: "@secret.anything" } },
      } } },
      actions: [],
    }));
    expect(issues).toHaveLength(0);
  });

  it("ENV: / SECRET: 規約文字列は @secret と無関係で後方互換", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      context: { catalogs: {
        secrets: { k: { source: "env", name: "X" } },
        externalSystems: {
          stripe: { name: "Stripe", auth: { kind: "bearer", tokenRef: "ENV:STRIPE_SECRET_KEY" } },
        },
      } },
      actions: [],
    }));
    expect(issues).toHaveLength(0);
  });
});

describe("checkReferentialIntegrity — typeRef (#261)", () => {
  const extensionsWithApiError = () => loadExtensionsFromBundle({
    responseTypes: {
      namespace: "",
      responseTypes: {
        ApiError: { schema: { type: "object" } },
      },
    },
  }).extensions;

  it("extensions responseTypes 定義時、未登録 typeRef を検出", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        responses: [{ id: "400", status: 400, bodySchema: { typeRef: "UnknownType" } }],
        steps: [],
      }],
    }), extensionsWithApiError());
    expect(issues.some((i) => i.code === "UNKNOWN_TYPE_REF")).toBe(true);
  });

  it("extensions 未指定時は typeRef 検査をスキップ (後方互換)", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        responses: [{ id: "400", status: 400, bodySchema: { typeRef: "AnyType" } }],
        steps: [],
      }],
    }));
    expect(issues).toHaveLength(0);
  });

  it("bodySchema が string 形式なら typeRef 検査対象外", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        responses: [{ id: "400", status: 400, bodySchema: "UnknownType" }],
        steps: [],
      }],
    }), extensionsWithApiError());
    expect(issues).toHaveLength(0);
  });
});

describe("checkReferentialIntegrity — systemRef (#261)", () => {
  it("externalSystemCatalog 定義時、未登録 systemRef を検出", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      context: { catalogs: { externalSystems: { stripe: { name: "Stripe" } } } },
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "s1", kind: "externalSystem", description: "",
          systemRef: "sendgrid",
        }],
      }],
    }));
    expect(issues.some((i) => i.code === "UNKNOWN_SYSTEM_REF")).toBe(true);
  });

  it("externalSystemCatalog 未定義時は systemRef 検査をスキップ (後方互換)", () => {
    const issues = checkReferentialIntegrity(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "s1", kind: "externalSystem", description: "",
          systemRef: "any",
        }],
      }],
    }));
    expect(issues).toHaveLength(0);
  });
});

