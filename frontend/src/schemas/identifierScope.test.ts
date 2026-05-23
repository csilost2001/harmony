import { describe, it, expect } from "vitest";
import { checkIdentifierScopes } from "./identifierScope";
import type { ProcessFlow } from "../types/v3";

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

describe("checkIdentifierScopes — ValidationStep.fieldErrorsVar (#1221 で明示必須化、暗黙束縛廃止)", () => {
  it("明示宣言された fieldErrorsVar が ngBodyExpression で参照可能", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          {
            id: "s1", kind: "validation", description: "", conditions: "",
            rules: [{ field: "x", type: "required" }],
            fieldErrorsVar: "fieldErrors",
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

  it("fieldErrorsVar 未宣言だと暗黙束縛されず @fieldErrors 参照は UNKNOWN_IDENTIFIER", () => {
    // schema-level required ガードが効くため通常は到達不可、それでも runtime cross-validator が
    // 暗黙束縛を提供しないことを明示する regression test (旧仕様: 'fieldErrors' を自動 known 化)
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [
          {
            id: "s1", kind: "validation", description: "",
            rules: [],
            inlineBranch: {
              ok: [],
              ng: [
                { id: "s1-ng", kind: "return", description: "", bodyExpression: "{ errors: @fieldErrors }" },
              ],
            },
            // intentionally omit fieldErrorsVar to verify implicit binding is gone
          },
        ],
      }],
    }));
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0].code).toBe("UNKNOWN_IDENTIFIER");
    expect(issues[0].identifier).toBe("fieldErrors");
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

describe("checkIdentifierScopes — @env.* catalog 参照", () => {
  it("context.catalogs.envVars で宣言された @env.CLAUDE_API_BASE_URL は参照 OK", () => {
    const issues = checkIdentifierScopes(makeGroup({
      context: {
        catalogs: {
          envVars: {
            CLAUDE_API_BASE_URL: {
              type: "string",
              description: "Claude API base URL",
              default: "https://api.anthropic.com",
            },
          },
        },
      },
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "s1", kind: "externalSystem", description: "",
          systemRef: "claudeApi",
          httpCall: { method: "POST", path: "@env.CLAUDE_API_BASE_URL + '/v1/messages'" },
        }],
      }],
    }));
    expect(issues).toHaveLength(0);
  });

  it("未宣言の @env.UNKNOWN_KEY は UNKNOWN_IDENTIFIER", () => {
    const issues = checkIdentifierScopes(makeGroup({
      context: { catalogs: { envVars: {} } },
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "s1", kind: "externalSystem", description: "",
          systemRef: "claudeApi",
          httpCall: { method: "POST", path: "@env.UNKNOWN_KEY + '/v1/messages'" },
        }],
      }],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].identifier).toBe("env.UNKNOWN_KEY");
    expect(issues[0].code).toBe("UNKNOWN_IDENTIFIER");
  });

  it("@env.CLAUDE_API_BASE_URL.subfield は未サポートとして reject", () => {
    const issues = checkIdentifierScopes(makeGroup({
      context: {
        catalogs: {
          envVars: {
            CLAUDE_API_BASE_URL: { type: "string" },
          },
        },
      },
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "s1", kind: "compute", description: "",
          expression: "@env.CLAUDE_API_BASE_URL.subfield",
          outputBinding: "x",
        }],
      }],
    }));
    expect(issues).toHaveLength(1);
    expect(issues[0].identifier).toBe("env.CLAUDE_API_BASE_URL.subfield");
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

  it("inlineBranch.ng 内で明示宣言された fieldErrorsVar を参照可能", () => {
    const issues = checkIdentifierScopes(makeGroup({
      actions: [{
        id: "a1", name: "f", trigger: "click",
        steps: [{
          id: "v1", kind: "validation", description: "",
          rules: [],
          fieldErrorsVar: "fieldErrors",
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

// #1289: @var.<scope>.<name> grammar-aware check (RFC #1264 verdict 実装)
describe("checkIdentifierScopes — #1289 @var.<scope>.<name> grammar-aware", () => {
  describe("flowParameter scope", () => {
    it("@var.flowParameter.<name> が action.inputs に存在 → OK", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          inputs: [{ name: "customerId", type: "number" }],
          steps: [
            { id: "s1", kind: "compute", description: "", expression: "@var.flowParameter.customerId * 2", outputBinding: { name: "doubled" } },
          ],
        }],
      }));
      expect(issues.filter((i) => i.identifier.startsWith("var.flowParameter"))).toHaveLength(0);
    });

    it("@var.flowParameter.<name> が action.inputs に無い → UNKNOWN_IDENTIFIER", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          inputs: [{ name: "customerId", type: "number" }],
          steps: [
            { id: "s1", kind: "compute", description: "", expression: "@var.flowParameter.unknownInput", outputBinding: { name: "x" } },
          ],
        }],
      }));
      expect(issues.some((i) => i.identifier === "var.flowParameter.unknownInput")).toBe(true);
    });

    it("@var.flowParameter (name 欠落) → error", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            { id: "s1", kind: "compute", description: "", expression: "@var.flowParameter", outputBinding: { name: "x" } },
          ],
        }],
      }));
      expect(issues.some((i) => i.identifier === "var.flowParameter")).toBe(true);
    });
  });

  describe("action scope", () => {
    it("@var.action.<name> が先行 step の outputBinding に存在 → OK (retail dogfood 実例)", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            {
              id: "tx-step", kind: "transactionScope", description: "",
              steps: [
                { id: "inner", kind: "compute", description: "", expression: "1", outputBinding: { name: "value" } },
              ],
              outputBinding: { name: "txResult" },
            },
            { id: "next", kind: "return", description: "", bodyExpression: "{ committed: @var.action.txResult.committed }" },
          ],
        }],
      }));
      expect(issues.filter((i) => i.identifier.startsWith("var.action"))).toHaveLength(0);
    });

    it("@var.action.<name> が action scope に無い → UNKNOWN_IDENTIFIER", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            { id: "s1", kind: "compute", description: "", expression: "@var.action.notDeclared", outputBinding: { name: "x" } },
          ],
        }],
      }));
      expect(issues.some((i) => i.identifier === "var.action.notDeclared")).toBe(true);
    });
  });

  describe("loop scope", () => {
    it("@var.loop.<collectionItemName> → OK (loop iteration item 参照)", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          inputs: [{ name: "items", type: { kind: "array", itemType: "number" } }],
          steps: [{
            id: "loop1", kind: "loop", description: "",
            loopKind: "collection",
            collectionSource: "@inputs.items",
            collectionItemName: "item",
            steps: [
              { id: "inner", kind: "compute", description: "", expression: "@var.loop.item * 2", outputBinding: { name: "doubled" } },
            ],
          }],
        }],
      }));
      expect(issues.filter((i) => i.identifier.startsWith("var.loop"))).toHaveLength(0);
    });

    it("@var.loop.<collectionIndexName> → OK (collection loop index 参照、#1264 verdict 観点 3)", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          inputs: [{ name: "items", type: { kind: "array", itemType: "number" } }],
          steps: [{
            id: "loop1", kind: "loop", description: "",
            loopKind: "collection",
            collectionSource: "@inputs.items",
            collectionItemName: "item",
            collectionIndexName: "idx",
            steps: [
              { id: "inner", kind: "compute", description: "", expression: "@var.loop.idx + 1", outputBinding: { name: "nextIdx" } },
            ],
          }],
        }],
      }));
      expect(issues.filter((i) => i.identifier.startsWith("var.loop"))).toHaveLength(0);
    });

    it("@var.loop.<name> が enclosing loop に無い → UNKNOWN_IDENTIFIER", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          inputs: [{ name: "items", type: { kind: "array", itemType: "number" } }],
          steps: [{
            id: "loop1", kind: "loop", description: "",
            loopKind: "collection",
            collectionSource: "@inputs.items",
            collectionItemName: "item",
            steps: [
              { id: "inner", kind: "compute", description: "", expression: "@var.loop.notDeclared", outputBinding: { name: "x" } },
            ],
          }],
        }],
      }));
      expect(issues.some((i) => i.identifier === "var.loop.notDeclared")).toBe(true);
    });

    it("@var.loop.<name> を loop 外で参照 → UNKNOWN_IDENTIFIER (loop item は外に leak しない)", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          inputs: [{ name: "items", type: { kind: "array", itemType: "number" } }],
          steps: [
            {
              id: "loop1", kind: "loop", description: "",
              loopKind: "collection",
              collectionSource: "@inputs.items",
              collectionItemName: "item",
              steps: [],
            },
            { id: "after", kind: "compute", description: "", expression: "@var.loop.item", outputBinding: { name: "x" } },
          ],
        }],
      }));
      expect(issues.some((i) => i.identifier === "var.loop.item")).toBe(true);
    });
  });

  describe("step scope", () => {
    it("@var.step.<stepId>.<name> が outputBinding.name と一致 → OK", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            { id: "fetch-step", kind: "compute", description: "", expression: "1", outputBinding: { name: "userData" } },
            { id: "use", kind: "return", description: "", bodyExpression: "{ name: @var.step.fetch-step.userData }" },
          ],
        }],
      }));
      expect(issues.filter((i) => i.identifier.startsWith("var.step"))).toHaveLength(0);
    });

    it("@var.step.<unknown-id> → UNKNOWN_IDENTIFIER", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            { id: "s1", kind: "compute", description: "", expression: "@var.step.no-such-step.field", outputBinding: { name: "x" } },
          ],
        }],
      }));
      expect(issues.some((i) => i.identifier === "var.step.no-such-step")).toBe(true);
    });

    it("@var.step.<id>.<wrongName> → outputBinding.name mismatch detected", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            { id: "fetch-step", kind: "compute", description: "", expression: "1", outputBinding: { name: "correctName" } },
            { id: "use", kind: "return", description: "", bodyExpression: "@var.step.fetch-step.wrongName" },
          ],
        }],
      }));
      expect(issues.some((i) => i.identifier === "var.step.fetch-step.wrongName")).toBe(true);
    });
  });

  describe("tx scope", () => {
    it("@var.tx.<txStepId>.committed (予約値) → OK (expose 不要)", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            {
              id: "tx-confirm", kind: "transactionScope", description: "",
              steps: [
                { id: "inner", kind: "compute", description: "", expression: "1", outputBinding: { name: "v" } },
              ],
            },
            { id: "check", kind: "return", description: "", bodyExpression: "{ ok: @var.tx.tx-confirm.committed }" },
          ],
        }],
      }));
      expect(issues.filter((i) => i.identifier.startsWith("var.tx"))).toHaveLength(0);
    });

    it("@var.tx.<txStepId>.error / .diagnostics (予約値) → OK", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            {
              id: "tx-confirm", kind: "transactionScope", description: "",
              steps: [
                { id: "inner", kind: "compute", description: "", expression: "1", outputBinding: { name: "v" } },
              ],
            },
            { id: "log-err", kind: "log", description: "", level: "error", message: "${@var.tx.tx-confirm.error.code} / ${@var.tx.tx-confirm.diagnostics}" },
          ],
        }],
      }));
      expect(issues.filter((i) => i.identifier.startsWith("var.tx"))).toHaveLength(0);
    });

    it("@var.tx.<unknown-id> → UNKNOWN_IDENTIFIER", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            { id: "s1", kind: "compute", description: "", expression: "@var.tx.no-such-tx.committed", outputBinding: { name: "x" } },
          ],
        }],
      }));
      expect(issues.some((i) => i.identifier === "var.tx.no-such-tx")).toBe(true);
    });

    it("@var.tx.<stepId> で <stepId> が非 transactionScope → UNKNOWN_IDENTIFIER", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            { id: "compute-step", kind: "compute", description: "", expression: "1", outputBinding: { name: "v" } },
            { id: "wrong", kind: "return", description: "", bodyExpression: "@var.tx.compute-step.committed" },
          ],
        }],
      }));
      expect(issues.some((i) => i.identifier === "var.tx.compute-step")).toBe(true);
    });
  });

  describe("global scope (silent pass、project-level)", () => {
    it("@var.global.<name> は silent pass (本 PR scope 外、別 validator 担当)", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            { id: "s1", kind: "compute", description: "", expression: "@var.global.tenantId", outputBinding: { name: "x" } },
          ],
        }],
      }));
      expect(issues.filter((i) => i.identifier.startsWith("var.global"))).toHaveLength(0);
    });
  });

  describe("shorthand @var.<name> (lexical chain auto-infer)", () => {
    it("@var.<name> が known scope に存在 → OK", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          inputs: [{ name: "amount", type: "number" }],
          steps: [
            { id: "s1", kind: "compute", description: "", expression: "@var.amount * 2", outputBinding: { name: "doubled" } },
          ],
        }],
      }));
      expect(issues.filter((i) => i.identifier.startsWith("var."))).toHaveLength(0);
    });

    it("@var.<name> が known scope に無い → UNKNOWN_IDENTIFIER", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            { id: "s1", kind: "compute", description: "", expression: "@var.notDeclared", outputBinding: { name: "x" } },
          ],
        }],
      }));
      expect(issues.some((i) => i.identifier === "var.notDeclared")).toBe(true);
    });

    it("@var 単独 (path 欠落) → error", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            { id: "s1", kind: "compute", description: "", expression: "@var", outputBinding: { name: "x" } },
          ],
        }],
      }));
      expect(issues.some((i) => i.identifier === "var")).toBe(true);
    });
  });

  describe("tryCatch.errorVar (catch block 内 named binding)", () => {
    it("catch branch 内で @var.<errorVar> 参照 → OK", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            {
              id: "br1", kind: "branch", description: "",
              branches: [
                {
                  id: "catch", code: "A",
                  condition: { kind: "tryCatch", errorCode: "VALIDATION_FAILED", errorVar: "caughtError" },
                  steps: [
                    { id: "log", kind: "log", description: "", level: "error", message: "${@var.caughtError.code}: ${@var.caughtError.message}" },
                  ],
                },
              ],
            },
          ],
        }],
      }));
      expect(issues.filter((i) => i.identifier.startsWith("var.caughtError"))).toHaveLength(0);
    });

    it("catch branch 外 (兄弟 branch) で errorVar 参照 → UNKNOWN_IDENTIFIER (scope leak しない)", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            {
              id: "br1", kind: "branch", description: "",
              branches: [
                {
                  id: "catch", code: "A",
                  condition: { kind: "tryCatch", errorCode: "VALIDATION_FAILED", errorVar: "caughtError" },
                  steps: [],
                },
                {
                  id: "other", code: "B",
                  condition: { kind: "expression", expression: "@var.caughtError" },
                  steps: [],
                },
              ],
            },
          ],
        }],
      }));
      expect(issues.some((i) => i.identifier === "var.caughtError")).toBe(true);
    });
  });

  describe("retail dogfood で実発生する canonical 形式の regression", () => {
    it("@var.action.txResult.committed (TX expose 予約値) → OK", () => {
      const issues = checkIdentifierScopes(makeGroup({
        actions: [{
          id: "a1", name: "f", trigger: "click",
          steps: [
            {
              id: "tx-confirm", kind: "transactionScope", description: "",
              steps: [
                { id: "inner", kind: "compute", description: "", expression: "1", outputBinding: { name: "v" } },
              ],
              outputBinding: { name: "txResult" },
            },
            { id: "after", kind: "return", description: "", bodyExpression: "@var.action.txResult.committed" },
            { id: "alt", kind: "compute", description: "", expression: "@var.action.txResult.error.code === 'STOCK_SHORTAGE'", outputBinding: { name: "isShortage" }, runIf: "@var.action.txResult.committed == false" },
          ],
        }],
      }));
      expect(issues.filter((i) => i.identifier.startsWith("var"))).toHaveLength(0);
    });
  });
});
