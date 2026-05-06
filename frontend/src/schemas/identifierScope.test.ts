import { describe, it, expect } from "vitest";
import { checkIdentifierScopes } from "./identifierScope";
import type { ProcessFlow } from "../types/action";

function makeGroup(partial: Partial<ProcessFlow>): ProcessFlow {
  return {
    meta: { id: "a", name: "x", kind: "screen", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
    actions: [],
    ...partial,
  } as ProcessFlow;
}

describe("checkIdentifierScopes — inputs / outputs", () => {
  it("inputs で宣言された識別子は参照 OK", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        inputs: [{ name: "userId", type: "number" }],
        steps: [
          { id: "s1", kind: "compute", description: "", expression: "@userId + 1", outputBinding: "doubled" },
        ],
      }],
    }));
    expect(issues).toHaveLength(0);
  });

  it("@inputs 全体参照 (@inputs.items) は OK (structured inputs がある場合)", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        inputs: [{ name: "items", type: { kind: "array", itemType: "number" } }],
        steps: [{
          id: "s1", kind: "loop", description: "",
          loopKind: "collection",
          collectionSource: "@inputs.items",
          collectionItemName: "item",
          steps: [],
        }],
      }],
    }));
    expect(issues).toHaveLength(0);
  });

  it("@outputs 全体参照は OK (structured outputs がある場合)", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        outputs: [{ name: "result", type: "string" }],
        steps: [{
          id: "s1", kind: "compute", description: "",
          expression: "@outputs.result",
          outputBinding: "x",
        }],
      }],
    }));
    expect(issues).toHaveLength(0);
  });

  it("未定義 @identifier を検出", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          { id: "s1", kind: "compute", description: "", expression: "@unknownVar * 2", outputBinding: "r" },
        ],
      }],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].identifier).toBe("unknownVar");
    expect(issues[0].code).toBe("UNKNOWN_IDENTIFIER");
  });
});

describe("checkIdentifierScopes — outputBinding が後続ステップで参照可能", () => {
  it("step1.outputBinding → step2 で参照 OK", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        inputs: [{ name: "x", type: "number" }],
        steps: [
          { id: "s1", kind: "compute", description: "", expression: "@x * 2", outputBinding: { name: "doubled" } },
          { id: "s2", kind: "compute", description: "", expression: "@doubled + 1", outputBinding: { name: "r" } },
        ],
      }],
    }));
    expect(issues).toHaveLength(0);
  });
});

describe("checkIdentifierScopes — ambient 変数", () => {
  it("ambientVariables で宣言されれば参照 OK", () => {
    const issues = checkIdentifierScopes(makeGroup({
      context: { ambientVariables: [{ name: "requestId", type: "string" }] },
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          { id: "s1", kind: "externalSystem", description: "", systemRef: "x",
            idempotencyKey: "key-@requestId" },
        ],
      }],
    }));
    expect(issues).toHaveLength(0);
  });
});

describe("checkIdentifierScopes — ループ変数のスコープ", () => {
  it("ループ配下では collectionItemName が参照可能", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        inputs: [{ name: "items", type: "string" }],
        steps: [
          {
            id: "lp", kind: "loop", description: "",
            loopKind: "collection", collectionSource: "@items",
            collectionItemName: "item",
            steps: [
              { id: "s1", kind: "compute", description: "", expression: "@item.quantity", outputBinding: "q" },
            ],
          },
        ],
      }],
    }));
    expect(issues).toHaveLength(0);
  });

  it("ループ外では item は未定義", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        inputs: [{ name: "items", type: "string" }],
        steps: [
          {
            id: "lp", kind: "loop", description: "",
            loopKind: "collection", collectionSource: "@items",
            collectionItemName: "item",
            steps: [],
          },
          { id: "s-after", kind: "compute", description: "", expression: "@item.quantity", outputBinding: "q" },
        ],
      }],
    }));
    expect(issues.some((i) => i.identifier === "item")).toBe(true);
  });
});

describe("checkIdentifierScopes — ValidationStep.fieldErrorsVar", () => {
  it("既定 fieldErrors が ngBodyExpression で参照可能", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          {
            id: "s1", kind: "validation", description: "", conditions: "",
            rules: [{ field: "x", type: "required" }],
            inlineBranch: { ok: [], ng: [], ngBodyExpression: "{ errors: @fieldErrors }" },
          },
        ],
      }],
    }));
    expect(issues).toHaveLength(0);
  });

  it("カスタム fieldErrorsVar 名で宣言し参照可能", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          {
            id: "s1", kind: "validation", description: "", conditions: "",
            rules: [{ field: "x", type: "required" }],
            fieldErrorsVar: "myErrors",
          },
          {
            id: "s2", kind: "return", description: "",
            bodyExpression: "{ errors: @myErrors }",
          },
        ],
      }],
    }));
    expect(issues).toHaveLength(0);
  });
});

describe("checkIdentifierScopes — @conv.* は検査対象外", () => {
  it("@conv.msg.* などは未定義扱いしない (別機能で解決)", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          {
            id: "s1", kind: "validation", description: "", conditions: "",
            rules: [{ field: "x", type: "custom", message: "@conv.msg.required" }],
          },
        ],
      }],
    }));
    expect(issues).toHaveLength(0);
  });
});

describe("checkIdentifierScopes — SQL 内の @identifier", () => {
  it("SQL 内の @ 参照も検査", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        inputs: [{ name: "customerId", type: "number" }],
        steps: [
          {
            id: "s1", kind: "dbAccess", description: "",
            tableName: "customers", operation: "SELECT",
            sql: "SELECT id FROM customers WHERE id = @customerId AND org_id = @unknownOrg",
          },
        ],
      }],
    }));
    expect(issues.some((i) => i.identifier === "unknownOrg")).toBe(true);
    expect(issues.every((i) => i.identifier !== "customerId")).toBe(true);
  });
});

describe("checkIdentifierScopes — 組み込み関数 BUILTIN_AMBIENTS", () => {
  it("@fn.calcTax(...) は UNKNOWN_IDENTIFIER を出さない", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        inputs: [{ name: "amount", type: "number" }],
        steps: [
          { id: "s1", kind: "compute", description: "", expression: "@fn.calcTax(@amount)", outputBinding: "tax" },
        ],
      }],
    }));
    expect(issues.filter((i) => i.identifier === "fn")).toHaveLength(0);
  });

  it("@now は UNKNOWN_IDENTIFIER を出さない", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          { id: "s1", kind: "compute", description: "", expression: "@now.toISOString()", outputBinding: "ts" },
        ],
      }],
    }));
    expect(issues.filter((i) => i.identifier === "now")).toHaveLength(0);
  });

  it("@uuid は UNKNOWN_IDENTIFIER を出さない", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          { id: "s1", kind: "compute", description: "", expression: "@uuid", outputBinding: "id" },
        ],
      }],
    }));
    expect(issues.filter((i) => i.identifier === "uuid")).toHaveLength(0);
  });

  it("@secret.token は UNKNOWN_IDENTIFIER を出さない", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          { id: "s1", kind: "compute", description: "", expression: "@secret.token", outputBinding: "tok" },
        ],
      }],
    }));
    expect(issues.filter((i) => i.identifier === "secret")).toHaveLength(0);
  });

  it("@conv.tax.standard.rate は UNKNOWN_IDENTIFIER を出さない", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        inputs: [{ name: "subtotal", type: "number" }],
        steps: [
          { id: "s1", kind: "compute", description: "", expression: "@subtotal * @conv.tax.standard.rate", outputBinding: "tax" },
        ],
      }],
    }));
    expect(issues.filter((i) => i.identifier === "conv")).toHaveLength(0);
    expect(issues.filter((i) => i.identifier === "subtotal")).toHaveLength(0);
  });

  it("未知識別子はそのまま検出される (BUILTIN_AMBIENTS による誤 suppress なし)", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          { id: "s1", kind: "compute", description: "", expression: "@reallyUnknownVar + 1", outputBinding: "r" },
        ],
      }],
    }));
    expect(issues.some((i) => i.identifier === "reallyUnknownVar")).toBe(true);
  });
});

describe("checkIdentifierScopes - TransactionScopeStep onRollback @error ambient", () => {
  it("allows @error inside transactionScope.onRollback", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "tx", kind: "transactionScope", description: "",
          steps: [
            { id: "s1", kind: "compute", description: "", expression: "1", outputBinding: "value" },
          ],
          onRollback: [
            { id: "rb1", kind: "return", description: "", bodyExpression: "{ message: @error.message }" },
          ],
        }],
      }],
    }));
    expect(issues.filter((i) => i.identifier === "error")).toHaveLength(0);
  });

  it("reports @error outside transactionScope.onRollback", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          { id: "s1", kind: "return", description: "", bodyExpression: "{ message: @error.message }" },
        ],
      }],
    }));
    const errorIssues = issues.filter((i) => i.identifier === "error");
    expect(errorIssues).toHaveLength(1);
    expect(errorIssues[0].code).toBe("UNKNOWN_IDENTIFIER");
  });

  // ケース C: walkSteps が onRollback 内の nested step (branch.condition / 内部 return.bodyExpression)
  // にも onRollbackKnown を再帰継承することを確認
  it("inherits @error inside nested onRollback steps", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "tx", kind: "transactionScope", description: "",
          steps: [
            { id: "s1", kind: "compute", description: "", expression: "1", outputBinding: "value" },
          ],
          onRollback: [{
            id: "branch", kind: "branch", description: "",
            branches: [{
              condition: "@error.code == 'STOCK_SHORTAGE'",
              steps: [
                { id: "rb1", kind: "return", description: "", bodyExpression: "{ code: @error.code }" },
              ],
            }],
          }],
        }],
      }],
    }));
    expect(issues.filter((i) => i.identifier === "error")).toHaveLength(0);
  });
});

describe("checkIdentifierScopes — WorkflowStep result handlers", () => {
  it("onApproved 内で未宣言識別子を UNKNOWN_IDENTIFIER として検出する", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "wf", kind: "workflow", description: "",
          pattern: "approval-sequential", approvers: [],
          onApproved: [
            { id: "s1", kind: "compute", description: "", expression: "@undeclared + 1", outputBinding: "r" },
          ],
        }],
      }],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].identifier).toBe("undeclared");
    expect(issues[0].code).toBe("UNKNOWN_IDENTIFIER");
  });

  it("onRejected 内で先行 step の outputBinding を参照可能", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          { id: "s1", kind: "compute", description: "", expression: "'req-1'", outputBinding: { name: "requestId" } },
          {
            id: "wf", kind: "workflow", description: "",
            pattern: "approval-sequential", approvers: [],
            onRejected: [
              { id: "s2", kind: "return", description: "", bodyExpression: "{ requestId: @requestId }" },
            ],
          },
        ],
      }],
    }));
    expect(issues).toHaveLength(0);
  });

  it("onApproved 内で WorkflowStep 自身の outputBinding を参照可能", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "wf", kind: "workflow", description: "",
          pattern: "approval-sequential", approvers: [],
          outputBinding: { name: "workflowResult" },
          onApproved: [
            { id: "s1", kind: "compute", description: "", expression: "@workflowResult.status", outputBinding: { name: "status" } },
          ],
        }],
      }],
    }));
    expect(issues).toHaveLength(0);
  });

  it("onTimeout 内で BUILTIN (@now / @uuid) を参照可能", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "wf", kind: "workflow", description: "",
          pattern: "approval-sequential", approvers: [],
          onTimeout: [
            { id: "s1", kind: "compute", description: "", expression: "@now.toISOString() + @uuid", outputBinding: "timeoutId" },
          ],
        }],
      }],
    }));
    expect(issues).toHaveLength(0);
  });
});

describe("checkIdentifierScopes — ValidationStep inlineBranch", () => {
  it("inlineBranch.ok 内で未宣言識別子を UNKNOWN_IDENTIFIER として検出する", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "v1", kind: "validation", description: "",
          rules: [],
          inlineBranch: {
            ok: [
              { id: "s1", kind: "compute", description: "", expression: "@undeclared + 1", outputBinding: "r" },
            ],
            ng: [],
          },
        }],
      }],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].identifier).toBe("undeclared");
    expect(issues[0].code).toBe("UNKNOWN_IDENTIFIER");
  });

  it("inlineBranch.ng 内で fieldErrors を参照可能 (validation step の暗黙宣言)", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "v1", kind: "validation", description: "",
          rules: [],
          inlineBranch: {
            ok: [],
            ng: [
              { id: "s1", kind: "return", description: "", bodyExpression: "{ errors: @fieldErrors }" },
            ],
          },
        }],
      }],
    }));
    expect(issues).toHaveLength(0);
  });

  it("inlineBranch.ok 内で先行 step の outputBinding を参照可能", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          { id: "s0", kind: "compute", description: "", expression: "'r'", outputBinding: { name: "requestId" } },
          {
            id: "v1", kind: "validation", description: "",
            rules: [],
            inlineBranch: {
              ok: [
                { id: "s1", kind: "return", description: "", bodyExpression: "{ requestId: @requestId }" },
              ],
              ng: [],
            },
          },
        ],
      }],
    }));
    expect(issues).toHaveLength(0);
  });
});
