import { describe, it, expect } from "vitest";
import { checkAntipatterns } from "./processFlowAntipatternValidator";
import type { ProcessFlow } from "../types/v3";

// ─── テスト用 fixture ヘルパー ────────────────────────────────────────────────

function makeFlow(steps: unknown[]): ProcessFlow {
  return {
    meta: { id: "test-flow", name: "Test Flow", kind: "screen", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    context: {},
    actions: [
      {
        id: "action-1",
        name: "Action 1",
        steps,
      },
    ],
    authoring: { createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  } as unknown as ProcessFlow;
}

// ─── Check 16: LITERAL_CONV_REFERENCE ───────────────────────────────────────

describe("Check 16: LITERAL_CONV_REFERENCE", () => {
  it("positive: シングルクォート内の @conv 参照を検出する", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "'@conv.msg.productNotFound'.replace('X', 'Y')",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "LITERAL_CONV_REFERENCE");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
    expect(found[0].path).toContain("expression");
  });

  it("positive: ダブルクォート内の @conv 参照を検出する", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: '"@conv.msg.orderConfirmed"',
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "LITERAL_CONV_REFERENCE");
    expect(found.length).toBeGreaterThan(0);
  });

  it("negative: クォートなしの @conv 参照は検出しない", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@conv.msg.productNotFound.replace('X', 'Y')",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "LITERAL_CONV_REFERENCE");
    expect(found).toHaveLength(0);
  });

  it("negative: @conv を含まない通常の文字列は検出しない", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "'hello world'.replace('hello', 'hi')",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "LITERAL_CONV_REFERENCE");
    expect(found).toHaveLength(0);
  });
});

// ─── Check 17: DUPLICATE_KIND_KEY ───────────────────────────────────────────

describe("Check 17: DUPLICATE_KIND_KEY", () => {
  it("positive: step オブジェクトに kind フィールドが 2 つある raw JSON を検出する", () => {
    // JSON.parse で後者に上書きされてしまうため raw 文字列を直接構築する
    const rawJson = `{
  "meta": { "id": "test-flow", "name": "Test", "kind": "screen", "createdAt": "2026-01-01", "updatedAt": "2026-01-01" },
  "context": {},
  "actions": [
    {
      "id": "action-1",
      "name": "Action 1",
      "steps": [
        {
          "kind": "extensionStep",
          "kind": "retail:DispatchShipment",
          "id": "step-1",
          "config": {}
        }
      ]
    }
  ],
  "authoring": { "createdAt": "2026-01-01", "updatedAt": "2026-01-01" }
}`;
    // JSON.parse は重複キーで後者を採用するが flow オブジェクトとしては問題なく動く
    const flow = JSON.parse(rawJson) as ProcessFlow;
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "DUPLICATE_KIND_KEY");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
  });

  it("negative: kind フィールドが 1 つだけなら検出しない", () => {
    const flow = makeFlow([
      {
        kind: "extensionStep",
        id: "step-1",
        config: {},
      },
    ]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "DUPLICATE_KIND_KEY");
    expect(found).toHaveLength(0);
  });
});

// ─── Check 19: INVALID_SEQUENCE_CALL_SYNTAX ─────────────────────────────────

describe("Check 19: INVALID_SEQUENCE_CALL_SYNTAX", () => {
  it("positive: @conv.numbering.X.nextSeq() を検出する", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "String(@conv.numbering.orderNumber.nextSeq()).padStart(6, '0')",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "INVALID_SEQUENCE_CALL_SYNTAX");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
    expect(found[0].path).toContain("expression");
  });

  it("negative: dbAccess.sql 内の nextval() は検出しない (conv 経由でない)", () => {
    const step = {
      kind: "dbAccess",
      id: "step-1",
      sql: "SELECT 'ORD-' || LPAD(nextval('seq_order_number')::text, 6, '0') AS order_number",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "INVALID_SEQUENCE_CALL_SYNTAX");
    expect(found).toHaveLength(0);
  });

  it("negative: @conv.numbering を含むが呼び出し構文でない場合は検出しない", () => {
    // 単なる参照 (@conv.numbering.prefix など) は対象外
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@conv.numbering.prefix + '001'",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "INVALID_SEQUENCE_CALL_SYNTAX");
    expect(found).toHaveLength(0);
  });
});

// ─── Check 23: MULTIPLE_STATEMENTS_IN_SQL ───────────────────────────────────

describe("Check 23: MULTIPLE_STATEMENTS_IN_SQL", () => {
  it("positive: dbAccess.sql に ; で区切られた複数文を検出する", () => {
    const step = {
      kind: "dbAccess",
      id: "step-1",
      sql: "DELETE FROM cart_items WHERE cart_id = @cartId; UPDATE carts SET status = 'ordered' WHERE id = @cartId",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "MULTIPLE_STATEMENTS_IN_SQL");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("warning");
    expect(found[0].path).toContain(".sql");
  });

  it("negative: 末尾の ; のみは複数文とみなさない", () => {
    const step = {
      kind: "dbAccess",
      id: "step-1",
      sql: "SELECT * FROM orders WHERE id = @orderId;",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "MULTIPLE_STATEMENTS_IN_SQL");
    expect(found).toHaveLength(0);
  });

  it("negative: ; を含まない単一文は検出しない", () => {
    const step = {
      kind: "dbAccess",
      id: "step-1",
      sql: "SELECT * FROM orders WHERE customer_id = @customerId",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "MULTIPLE_STATEMENTS_IN_SQL");
    expect(found).toHaveLength(0);
  });

  it("negative: dbAccess 以外の step の sql フィールドは対象外", () => {
    // compute step は dbAccess でないので Check 23 対象外
    const step = {
      kind: "compute",
      id: "step-1",
      // これは意図的に不正なフィールドを持つテスト用の construct
      expression: "DELETE FROM a; UPDATE b SET x=1",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "MULTIPLE_STATEMENTS_IN_SQL");
    expect(found).toHaveLength(0);
  });

  it("negative: 文字列リテラル内の `;` は単一文扱い (false positive 防止)", () => {
    const step = {
      kind: "dbAccess",
      id: "step-1",
      sql: "SELECT * FROM users WHERE name = 'a;b' AND status = 'ok'",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "MULTIPLE_STATEMENTS_IN_SQL");
    expect(found).toHaveLength(0);
  });

  it("negative: SQL 標準のエスケープシングルクォート '' を含む文字列リテラル", () => {
    const step = {
      kind: "dbAccess",
      id: "step-1",
      sql: "SELECT * FROM users WHERE comment = 'it''s a; test'",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "MULTIPLE_STATEMENTS_IN_SQL");
    expect(found).toHaveLength(0);
  });

  it("negative: 行コメント `--` 内の `;` は単一文扱い", () => {
    const step = {
      kind: "dbAccess",
      id: "step-1",
      sql: "SELECT id FROM orders -- TODO: optimize; index hint\nWHERE customer_id = @customerId",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "MULTIPLE_STATEMENTS_IN_SQL");
    expect(found).toHaveLength(0);
  });

  it("negative: ブロックコメント `/* */` 内の `;` は単一文扱い", () => {
    const step = {
      kind: "dbAccess",
      id: "step-1",
      sql: "SELECT id /* multi-line; with; semicolons */ FROM orders WHERE id = @orderId",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "MULTIPLE_STATEMENTS_IN_SQL");
    expect(found).toHaveLength(0);
  });

  it("negative: PL/pgSQL ドル引用 `$$ ... $$` 内の `;` は単一文扱い", () => {
    const step = {
      kind: "dbAccess",
      id: "step-1",
      sql: "DO $$ BEGIN UPDATE accounts SET balance = balance + 100; UPDATE accounts SET locked = true; END $$",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "MULTIPLE_STATEMENTS_IN_SQL");
    expect(found).toHaveLength(0);
  });

  it("negative: タグ付きドル引用 `$tag$ ... $tag$` 内の `;` は単一文扱い", () => {
    const step = {
      kind: "dbAccess",
      id: "step-1",
      sql: "CREATE FUNCTION f() RETURNS void AS $body$ BEGIN UPDATE x SET v = 1; END $body$ LANGUAGE plpgsql",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "MULTIPLE_STATEMENTS_IN_SQL");
    expect(found).toHaveLength(0);
  });

  it("positive: ドル引用ブロックの後に別文がある場合は複数文として検出", () => {
    const step = {
      kind: "dbAccess",
      id: "step-1",
      sql: "DO $$ BEGIN UPDATE x SET v = 1; END $$; SELECT 1",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "MULTIPLE_STATEMENTS_IN_SQL");
    expect(found.length).toBeGreaterThan(0);
  });
});

// ─── Check 30: SIDE_EFFECT_INLINE_BAN (#1263 Phase X2) ───────────────────────

describe("Check 30: SIDE_EFFECT_INLINE_BAN (#1263 Phase X2)", () => {
  it("positive: ${...} 内の @flow.<id> 呼び出しを検出する", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "Hello ${@flow.someFlowId(arg=1)} world",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "SIDE_EFFECT_INLINE_BAN");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
    expect(found[0].message).toContain("@flow");
  });

  it("positive: ${...} 内の @action.<id> 呼び出しを検出する", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "${@action.confirmOrder(orderId=@var.action.orderId)}",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "SIDE_EFFECT_INLINE_BAN");
    expect(found.length).toBeGreaterThan(0);
  });

  it("positive: ${...} 内の @step.<id> / @component.<name> / @rule.<name> 呼び出しを検出する", () => {
    const expressions = [
      "${@step.step-01.outputBinding}",
      "${@component.OrderValidator.validate(@var.action.order)}",
      "${@rule.authzCheck(@var.action.user)}",
    ];
    for (const expr of expressions) {
      const flow = makeFlow([{ kind: "compute", id: "step-1", expression: expr }]);
      const rawJson = JSON.stringify(flow, null, 2);
      const issues = checkAntipatterns(flow, rawJson);
      const found = issues.filter((i) => i.code === "SIDE_EFFECT_INLINE_BAN");
      expect(found.length).toBeGreaterThan(0);
    }
  });

  it("negative: pure ref (@var / @conv / @msg / @const / @validation) は許容", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression:
        "Hello ${@var.action.userName}, your ${@const.taxRate} is ${@msg.notice} validating ${@validation.isPositive(@var.action.quantity)} with ${@conv.numbering.orderNumber}",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "SIDE_EFFECT_INLINE_BAN");
    expect(found).toHaveLength(0);
  });

  it("negative: ${...} の外側で @flow 言及されている場合は検出しない", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      // ${...} の外側、e.g. リテラルの中で `@flow` という単語を使うだけ
      expression: "'説明: @flow という記法はinline禁止'",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "SIDE_EFFECT_INLINE_BAN");
    expect(found).toHaveLength(0);
  });

  it("positive: ${...} 内に nested object literal {foo: 1} を含む後続 @flow.<id> 呼出を検出 (#1267 Codex review fix)", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      // simple regex /\$\{([^}]*)\}/ は最初の `}` で切れて後続を見逃す。
      // brace-counting parser で正しく検出する必要がある。
      expression: "${someHelper({foo: 1, bar: 2}) + @flow.someFlowId(arg=1)}",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "SIDE_EFFECT_INLINE_BAN");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].message).toContain("@flow");
  });

  it("positive: ${...} 内に nested array literal + nested {...} + @action.<id> 呼出を検出", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "${[1, 2, {x: {y: 'z'}}].map(v => @action.handler(v))}",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "SIDE_EFFECT_INLINE_BAN");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].message).toContain("@action");
  });

  it("negative: ${...} 内の文字列リテラル '${a}' の中の `}` は depth に含めない", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      // 文字列リテラル内の `}` (` 'inline-}' ` 等) で外側 `}` と混同しないこと
      expression: "${'literal-}-here' + @var.action.foo}",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "SIDE_EFFECT_INLINE_BAN");
    expect(found).toHaveLength(0);
  });
});

// ─── Check 31: BROKEN_REFERENCE_MATURITY_AWARE (#1263 Phase X2) ──────────────

describe("Check 31: BROKEN_REFERENCE_MATURITY_AWARE (#1263 Phase X2)", () => {
  it("positive (committed): 未定義 @var.<name> は error として検出", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@var.unknownVarThatDoesNotExist",
    };
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [{ id: "action-1" as never, name: "Action 1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
  });

  it("positive (draft): 未定義 @var.<name> は warning として検出", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@var.unknownVarThatDoesNotExist",
    };
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "draft", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [{ id: "action-1" as never, name: "Action 1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("warning");
  });

  it("negative: 6 値 scope enum + 実 step-id / tx-id (@var.flowParameter etc) は許容", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            { kind: "transactionScope", id: "step-tx", description: "TX", outputBinding: { name: "txResult" as never, expose: ["committed"] }, steps: [] } as never,
            // step.<step-id> は実 step を指す必要があるため step-tx を参照
            { kind: "compute", id: "step-ref", expression: "@var.flowParameter.foo + @var.action.bar + @var.step.step-tx.committed + @var.tx.step-tx.committed + @var.loop.idx + @var.global.tenant", description: "all 6 scopes" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE");
    expect(found).toHaveLength(0);
  });

  it("negative: 既知 conv category (@conv.msg / @conv.regex 等) は許容", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@conv.msg.orderConfirmed + @conv.regex.email + @conv.tx.orderConfirm",
    };
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [{ id: "action-1" as never, name: "Action 1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE");
    expect(found).toHaveLength(0);
  });

  it("negative: action.inputs[].name で定義された変数は許容", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          inputs: [{ name: "customerId" as never, type: "string" }],
          steps: [{ kind: "compute", id: "step-1", expression: "@var.customerId", description: "use input" } as never],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE");
    expect(found).toHaveLength(0);
  });

  it("positive: @var.step.<unknown-step-id> は壊れ参照として検出 (#1267 Codex review fix)", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            { kind: "compute", id: "step-real", expression: "@var.step.unknownStepIdThatDoesNotExist.foo", description: "ref nonexistent step" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
    expect(found[0].message).toContain("@var.step.unknownStepIdThatDoesNotExist");
  });

  it("positive: @var.tx.<unknown-tx-id> は壊れ参照として検出 (#1267 Codex review fix)", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            { kind: "compute", id: "step-real", expression: "@var.tx.unknownTxIdThatDoesNotExist.committed", description: "ref nonexistent tx" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
    expect(found[0].message).toContain("@var.tx.unknownTxIdThatDoesNotExist");
  });

  it("negative: @var.step.<real-step-id> は flow に存在する step-id なら許容", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            { kind: "dbAccess", id: "step-01", tableId: "00000000-0000-4000-8000-000000000001" as never, operation: "SELECT", outputBinding: { name: "rows" as never }, description: "fetch" } as never,
            { kind: "compute", id: "step-02", expression: "@var.step.step-01.foo", description: "ref existing step" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE");
    expect(found).toHaveLength(0);
  });

  it("negative: @var.tx.<real-tx-id> は flow に存在する transactionScope step なら許容", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            { kind: "transactionScope", id: "step-tx", description: "TX", outputBinding: { name: "txResult" as never, expose: ["committed", "error"] }, steps: [] } as never,
            { kind: "compute", id: "step-after", expression: "@var.tx.step-tx.committed", description: "ref TX" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE");
    expect(found).toHaveLength(0);
  });
});
