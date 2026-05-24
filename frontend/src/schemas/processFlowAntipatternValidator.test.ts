import { describe, it, expect } from "vitest";
import { checkAntipatterns } from "./processFlowAntipatternValidator";
import { buildProjectCatalogIndex } from "./projectCatalogIndex";
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

  it("negative: 文字列内の word boundary 違反 (user@var.foo / x@flow.bar 等) を false positive しない (#1267 Opus S-1)", () => {
    // email address や IRC ハンドル風文字列で誤検出しないこと
    // Description が TemplateString 統合された影響で email を含む description は増えると想定
    const step = {
      kind: "compute",
      id: "step-1",
      description: "問い合わせ先 user@var.example で OK。issue は githubuser@flow.tag に通知。",
      expression: "1 + 1",
    };
    const flow = makeFlow([step]);
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "SIDE_EFFECT_INLINE_BAN" || i.code === "BROKEN_REFERENCE_MATURITY_AWARE");
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

  it("negative: 階層参照 `@screen.<UUID>.item.<id>` は数字始まり UUID でも false positive を出さない (#1269 提案 A)", () => {
    // docs/spec/process-flow-prefix-system.md §3 階層参照記法。Phase A では @screen は silent pass
    // (project catalog load 未実装、Phase C で活性化予定) のため、broken ref として検出しないこと
    // を保証する。
    const step = {
      kind: "compute",
      id: "step-1",
      // 数字始まり (0739c454-...) / 文字始まり (cff4a398-...) の両 UUID を含む
      expression:
        "@screen.0739c454-45d6-4c99-962a-7b0b9e113a22.item.searchQuery + " +
        "@screen.cff4a398-99cd-4aa5-bfbd-c12d5e72c5f3.item.shippingPostalCode",
    };
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [{ id: "action-1" as never, name: "Action 1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter(
      (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE" && i.message.includes("@screen"),
    );
    expect(found).toHaveLength(0);
  });

  it("negative: @conv の未知 category は本 PR では検出 skip (#1267 Opus S-2、#1269 で再活性化)", () => {
    // project 拡張の conventionCategories 取りこぼし回避のため、本 PR では @conv broken-ref
    // 検出を一時 disable している。Phase X3 で project-level catalog load を実装後再活性化。
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@conv.customExtensionCategory.foo + @conv.anotherUnknownCat.bar",
    };
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [{ id: "action-1" as never, name: "Action 1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE" && i.message.includes("@conv"));
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

// ─── Check 31 (#1322 Phase B-3a): designer-time alias @this / @self の context 注入 ─

describe("Check 31 (#1322 Phase B-3a): @this / @self designer-time alias", () => {
  it("negative: @this.action.<existing-id> は flow.actions[].id に一致 → no issue", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@this.action.action-1.outputBinding",
    };
    const flow: ProcessFlow = {
      meta: {
        id: "test-flow" as never,
        name: "Test",
        flowType: "screen",
        maturity: "committed",
        createdAt: "2026-01-01" as never,
        updatedAt: "2026-01-01" as never,
      },
      actions: [{ id: "action-1" as never, name: "A1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter(
      (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE" && i.message.includes("@this"),
    );
    expect(found).toHaveLength(0);
  });

  it("positive: @this.action.<unknown-id> は broken ref として検出", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@this.action.nonExistentAction.foo",
    };
    const flow: ProcessFlow = {
      meta: {
        id: "test-flow" as never,
        name: "Test",
        flowType: "screen",
        maturity: "committed",
        createdAt: "2026-01-01" as never,
        updatedAt: "2026-01-01" as never,
      },
      actions: [{ id: "action-1" as never, name: "A1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter(
      (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE" && i.message.includes("@this"),
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
  });

  it("negative: @this.meta.<known-field> (id / name / flowType / sla 等) は no issue", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@this.meta.id + @this.meta.flowType + @this.meta.maturity + @this.meta.sla.responseTime",
    };
    const flow: ProcessFlow = {
      meta: {
        id: "test-flow" as never,
        name: "Test",
        flowType: "screen",
        maturity: "draft",
        createdAt: "2026-01-01" as never,
        updatedAt: "2026-01-01" as never,
      },
      actions: [{ id: "action-1" as never, name: "A1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter(
      (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE" && i.message.includes("@this"),
    );
    expect(found).toHaveLength(0);
  });

  it("positive: @this.meta.<unknown-field> は broken ref として検出", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@this.meta.unknownMetaField",
    };
    const flow: ProcessFlow = {
      meta: {
        id: "test-flow" as never,
        name: "Test",
        flowType: "screen",
        maturity: "committed",
        createdAt: "2026-01-01" as never,
        updatedAt: "2026-01-01" as never,
      },
      actions: [{ id: "action-1" as never, name: "A1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter(
      (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE" && i.message.includes("@this"),
    );
    expect(found.length).toBeGreaterThan(0);
  });

  it("positive: @this.<unknown-top-level> は broken ref として検出", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@this.unknownTopLevelField",
    };
    const flow: ProcessFlow = {
      meta: {
        id: "test-flow" as never,
        name: "Test",
        flowType: "screen",
        maturity: "draft",
        createdAt: "2026-01-01" as never,
        updatedAt: "2026-01-01" as never,
      },
      actions: [{ id: "action-1" as never, name: "A1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter(
      (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE" && i.message.includes("@this"),
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("warning");
  });

  it("negative: @this.context.<...> / @this.expressionLanguage は loose pass (catalog 深い nested)", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@this.context.catalogs.events + @this.expressionLanguage",
    };
    const flow: ProcessFlow = {
      meta: {
        id: "test-flow" as never,
        name: "Test",
        flowType: "screen",
        maturity: "committed",
        createdAt: "2026-01-01" as never,
        updatedAt: "2026-01-01" as never,
      },
      actions: [{ id: "action-1" as never, name: "A1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter(
      (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE" && i.message.includes("@this"),
    );
    expect(found).toHaveLength(0);
  });

  it("negative: @self.id / @self.runIf / @self.outputBinding.name は step 共通 5 field に該当 → no issue", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      // step body 内に @self.* を含む式
      expression: "@self.id + @self.runIf + @self.outputBinding.name",
    };
    const flow: ProcessFlow = {
      meta: {
        id: "test-flow" as never,
        name: "Test",
        flowType: "screen",
        maturity: "committed",
        createdAt: "2026-01-01" as never,
        updatedAt: "2026-01-01" as never,
      },
      actions: [{ id: "action-1" as never, name: "A1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter(
      (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE" && i.message.includes("@self"),
    );
    expect(found).toHaveLength(0);
  });

  it("positive: @self.<unknown-field> は broken ref として検出", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@self.someUnknownField",
    };
    const flow: ProcessFlow = {
      meta: {
        id: "test-flow" as never,
        name: "Test",
        flowType: "screen",
        maturity: "committed",
        createdAt: "2026-01-01" as never,
        updatedAt: "2026-01-01" as never,
      },
      actions: [{ id: "action-1" as never, name: "A1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter(
      (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE" && i.message.includes("@self"),
    );
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
  });

  it("draft maturity では @this / @self の broken ref は warning として検出", () => {
    const step = {
      kind: "compute",
      id: "step-1",
      expression: "@this.unknownTopLevel + @self.unknownField",
    };
    const flow: ProcessFlow = {
      meta: {
        id: "test-flow" as never,
        name: "Test",
        flowType: "screen",
        maturity: "draft",
        createdAt: "2026-01-01" as never,
        updatedAt: "2026-01-01" as never,
      },
      actions: [{ id: "action-1" as never, name: "A1", trigger: "click", steps: [step as never] }],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE");
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found.every((i) => i.severity === "warning")).toBe(true);
  });
});

// ─── Check 32: TX_INNER_VAR_LEAK_OUTSIDE_TX (#1267 Round 7 Must-fix 5) ─────────

describe("Check 32: TX_INNER_VAR_LEAK_OUTSIDE_TX (#1267 Round 7 Must-fix 5)", () => {
  it("positive (committed): TX 内 outputBinding を TX 外から `@<varName>.<field>` で参照 → error", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "transactionScope",
              id: "step-tx",
              description: "TX",
              outputBinding: { name: "txResult" as never, expose: ["committed", "error"] },
              steps: [
                {
                  kind: "dbAccess",
                  id: "step-tx-insert",
                  description: "insert",
                  tableId: "00000000-0000-4000-8000-000000000001" as never,
                  operation: "INSERT",
                  outputBinding: { name: "newScore" as never },
                } as never,
              ],
            } as never,
            // TX 外で TX inner var `newScore` を参照 → spec violation
            { kind: "compute", id: "step-after", expression: "@newScore.id", description: "ref tx inner" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "TX_INNER_VAR_LEAK_OUTSIDE_TX");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
    expect(found[0].message).toContain("newScore");
    expect(found[0].message).toContain("TX 内 → TX 外 mutation static 禁止");
  });

  it("positive (draft): 同上を maturity=draft で → warning", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "draft", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "transactionScope",
              id: "step-tx",
              description: "TX",
              outputBinding: { name: "txResult" as never, expose: ["committed"] },
              steps: [
                { kind: "compute", id: "step-tx-1", expression: "1", description: "compute", outputBinding: { name: "innerVar" as never } } as never,
              ],
            } as never,
            { kind: "compute", id: "step-after", expression: "@innerVar.x", description: "leak" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "TX_INNER_VAR_LEAK_OUTSIDE_TX");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("warning");
  });

  it("negative: TX 内 outputBinding を TX 内別 step から参照 → 許容 (TX scope 内では valid)", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "transactionScope",
              id: "step-tx",
              description: "TX",
              outputBinding: { name: "txResult" as never, expose: ["committed"] },
              steps: [
                { kind: "dbAccess", id: "step-tx-insert", description: "ins", tableId: "00000000-0000-4000-8000-000000000001" as never, operation: "INSERT", outputBinding: { name: "newScore" as never } } as never,
                // TX 内別 step が @newScore.id を参照 (同 TX scope 内、許容される)
                { kind: "eventPublish", id: "step-tx-publish", description: "pub", topic: "score.recorded", payload: "{ id: @newScore.id }" } as never,
              ],
            } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "TX_INNER_VAR_LEAK_OUTSIDE_TX");
    expect(found).toHaveLength(0);
  });

  it("negative: TX wrapper の outputBinding (txResult) を TX 外で `@txResult` shorthand 参照 → 許容 (expose 機構経由)", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "transactionScope",
              id: "step-tx",
              description: "TX",
              outputBinding: { name: "txResult" as never, expose: ["committed", "error"] },
              steps: [],
            } as never,
            // TX wrapper の outputBinding.name=txResult は action scope (varKeys) に追加されるため
            // TX 外参照は valid
            { kind: "compute", id: "step-after", expression: "@txResult.committed", description: "valid" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "TX_INNER_VAR_LEAK_OUTSIDE_TX");
    expect(found).toHaveLength(0);
  });

  it("positive (option C): TX 外で `@var.action.<txName>.<unknownKey>` 参照、unknownKey は expose 不在 → leak", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "transactionScope",
              id: "step-tx",
              description: "TX",
              outputBinding: { name: "txResult" as never, expose: ["committed"] },
              steps: [],
            } as never,
            // 予約値以外で expose に列挙されていない accessor → leak
            { kind: "compute", id: "step-after", expression: "@var.action.txResult.someUnknownKey.foo", description: "leak via canonical form" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "TX_INNER_VAR_LEAK_OUTSIDE_TX");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].message).toContain("someUnknownKey");
  });

  it("negative (option C): expose に列挙された inner var 名は `@var.action.<txName>.<innerVar>` で参照可", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "transactionScope",
              id: "step-tx",
              description: "TX",
              outputBinding: { name: "txResult" as never, expose: ["committed", "error", "newScore"] },
              steps: [
                { kind: "dbAccess", id: "step-tx-insert", description: "ins", tableId: "00000000-0000-4000-8000-000000000001" as never, operation: "INSERT", outputBinding: { name: "newScore" as never } } as never,
              ],
            } as never,
            // expose に "newScore" を列挙、TX 外から canonical form で参照 → OK
            { kind: "compute", id: "step-after", expression: "@var.action.txResult.newScore.id", description: "valid via expose" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "TX_INNER_VAR_LEAK_OUTSIDE_TX");
    expect(found).toHaveLength(0);
  });

  it("negative (option C): expose に列挙された inner var は shorthand `@<txName>.<innerVar>` でも参照可", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "transactionScope",
              id: "step-tx",
              description: "TX",
              outputBinding: { name: "txResult" as never, expose: ["committed", "newScore"] },
              steps: [
                { kind: "dbAccess", id: "step-tx-insert", description: "ins", tableId: "00000000-0000-4000-8000-000000000001" as never, operation: "INSERT", outputBinding: { name: "newScore" as never } } as never,
              ],
            } as never,
            // shorthand 形式 @<txName>.<innerVar>.<field>
            { kind: "compute", id: "step-after", expression: "@txResult.newScore.id", description: "valid via shorthand" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "TX_INNER_VAR_LEAK_OUTSIDE_TX");
    expect(found).toHaveLength(0);
  });

  it("positive (option C, @var.tx form): expose 不在 accessor を @var.tx.<step-id>.<accessor> で参照 → leak", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "transactionScope",
              id: "step-tx",
              description: "TX",
              outputBinding: { name: "txResult" as never, expose: ["committed"] },  // newScore NOT exposed
              steps: [
                { kind: "dbAccess", id: "step-tx-insert", description: "ins", tableId: "00000000-0000-4000-8000-000000000001" as never, operation: "INSERT", outputBinding: { name: "newScore" as never } } as never,
              ],
            } as never,
            // @var.tx.<step-id>.<accessor> 形式で expose 不在 accessor を参照 → leak
            { kind: "compute", id: "step-after", expression: "@var.tx.step-tx.newScore.id", description: "leak via @var.tx form" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "TX_INNER_VAR_LEAK_OUTSIDE_TX");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].message).toContain("newScore");
  });

  it("negative (option C, @var.tx form): expose 列挙済 accessor を @var.tx.<step-id>.<accessor> で参照 → 許容", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "transactionScope",
              id: "step-tx",
              description: "TX",
              outputBinding: { name: "txResult" as never, expose: ["committed", "newScore"] },
              steps: [
                { kind: "dbAccess", id: "step-tx-insert", description: "ins", tableId: "00000000-0000-4000-8000-000000000001" as never, operation: "INSERT", outputBinding: { name: "newScore" as never } } as never,
              ],
            } as never,
            { kind: "compute", id: "step-after", expression: "@var.tx.step-tx.newScore.id", description: "valid via @var.tx form" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "TX_INNER_VAR_LEAK_OUTSIDE_TX");
    expect(found).toHaveLength(0);
  });

  it("negative (option C, Round 8 Codex Must-fix): 同一 action 内に同名 outputBinding.name の TX が複数ある場合、expose は union される (false positive 回避)", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            // TX-A: expose に "newOrder" を列挙
            {
              kind: "transactionScope",
              id: "step-tx-a",
              description: "TX A",
              outputBinding: { name: "txResult" as never, expose: ["committed", "newOrder"] },
              steps: [
                { kind: "dbAccess", id: "step-a-ins", description: "ins", tableId: "00000000-0000-4000-8000-000000000001" as never, operation: "INSERT", outputBinding: { name: "newOrder" as never } } as never,
              ],
            } as never,
            // TX-B: 同名 outputBinding "txResult" で expose に "newPayment" を列挙
            // union merge により txExposeMap["txResult"] には {committed, error, diagnostics, newOrder, newPayment} が入る
            {
              kind: "transactionScope",
              id: "step-tx-b",
              description: "TX B",
              outputBinding: { name: "txResult" as never, expose: ["committed", "newPayment"] },
              steps: [
                { kind: "dbAccess", id: "step-b-ins", description: "ins", tableId: "00000000-0000-4000-8000-000000000002" as never, operation: "INSERT", outputBinding: { name: "newPayment" as never } } as never,
              ],
            } as never,
            // 両 TX の inner var を canonical form で参照 → 両方 OK (union のおかげ)
            { kind: "compute", id: "step-after", expression: "@var.action.txResult.newOrder.id + @var.action.txResult.newPayment.id", description: "ref both" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "TX_INNER_VAR_LEAK_OUTSIDE_TX");
    expect(found).toHaveLength(0);
  });

  it("positive (option C): expose に NOT 列挙の inner var は shorthand 直接参照で leak (canonical access form 経由のみ許容、本 case は inner shorthand `@<innerVar>`)", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "transactionScope",
              id: "step-tx",
              description: "TX",
              outputBinding: { name: "txResult" as never, expose: ["committed"] },  // newScore NOT exposed
              steps: [
                { kind: "dbAccess", id: "step-tx-insert", description: "ins", tableId: "00000000-0000-4000-8000-000000000001" as never, operation: "INSERT", outputBinding: { name: "newScore" as never } } as never,
              ],
            } as never,
            // newScore は expose されていない、shorthand 直接参照 → leak
            { kind: "compute", id: "step-after", expression: "@newScore.id", description: "leak — inner shorthand" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "TX_INNER_VAR_LEAK_OUTSIDE_TX");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].message).toContain("newScore");
  });

  it("negative: TX なしの通常 step 間 outputBinding 参照 → 許容 (TX boundary 不在のため)", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            { kind: "dbAccess", id: "step-01", description: "fetch", tableId: "00000000-0000-4000-8000-000000000001" as never, operation: "SELECT", outputBinding: { name: "rows" as never } } as never,
            { kind: "compute", id: "step-02", expression: "@rows.length", description: "use rows" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "TX_INNER_VAR_LEAK_OUTSIDE_TX");
    expect(found).toHaveLength(0);
  });
});

// ─── Check 33: DB_ACCESS_SQL_REQUIRED_FOR_COMMITTED (#1263 Phase X3 / #1254 件 5) ─

describe("Check 33: DB_ACCESS_SQL_REQUIRED_FOR_COMMITTED (#1263 Phase X3)", () => {
  it("positive (committed): sql 不在 + naturalQuery のみ → error (naturalQuery を AI 変換促す message)", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "dbAccess",
              id: "step-01",
              description: "fetch users",
              tableId: "00000000-0000-4000-8000-000000000001" as never,
              operation: "SELECT",
              naturalQuery: "ユーザーを id で取得",
              // sql 不在
              outputBinding: { name: "user" as never },
            } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "DB_ACCESS_SQL_REQUIRED_FOR_COMMITTED");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
    expect(found[0].message).toContain("naturalQuery");
    expect(found[0].message).toContain("committed");
  });

  it("positive (committed): sql 不在 + naturalQuery も不在 → error (シンプル message)", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "dbAccess",
              id: "step-01",
              description: "fetch",
              tableId: "00000000-0000-4000-8000-000000000001" as never,
              operation: "SELECT",
              outputBinding: { name: "rows" as never },
              // sql / naturalQuery 両方不在
            } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "DB_ACCESS_SQL_REQUIRED_FOR_COMMITTED");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].severity).toBe("error");
  });

  it("negative (draft): sql 不在 + naturalQuery のみ → 許容 (#1254 件 5 maturity-aware)", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "draft", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "dbAccess",
              id: "step-01",
              description: "fetch users — naturalQuery only (draft)",
              tableId: "00000000-0000-4000-8000-000000000001" as never,
              operation: "SELECT",
              naturalQuery: "ユーザーを id で取得",
              outputBinding: { name: "user" as never },
            } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "DB_ACCESS_SQL_REQUIRED_FOR_COMMITTED");
    expect(found).toHaveLength(0);
  });

  it("negative (committed): sql あり → 許容 (naturalQuery 併用も OK)", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            {
              kind: "dbAccess",
              id: "step-01",
              description: "fetch users",
              tableId: "00000000-0000-4000-8000-000000000001" as never,
              operation: "SELECT",
              sql: "SELECT * FROM users WHERE id = @inputs.userId",
              naturalQuery: "ユーザーを id で取得",  // 併用 OK
              outputBinding: { name: "user" as never },
            } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "DB_ACCESS_SQL_REQUIRED_FOR_COMMITTED");
    expect(found).toHaveLength(0);
  });

  it("negative: dbAccess 以外の step は対象外", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "committed", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1",
          trigger: "click",
          steps: [
            { kind: "compute", id: "step-01", description: "compute", expression: "1+1" } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "DB_ACCESS_SQL_REQUIRED_FOR_COMMITTED");
    expect(found).toHaveLength(0);
  });

  it("positive: flow=draft でも action.maturity=committed なら sql 必須 (Round 2 SF-3)", () => {
    const flow: ProcessFlow = {
      meta: { id: "test-flow" as never, name: "Test", flowType: "screen", maturity: "draft", createdAt: "2026-01-01" as never, updatedAt: "2026-01-01" as never },
      actions: [
        {
          id: "action-1" as never,
          name: "Action 1 (committed)",
          trigger: "click",
          maturity: "committed",
          steps: [
            {
              kind: "dbAccess",
              id: "step-01",
              description: "fetch users",
              tableId: "00000000-0000-4000-8000-000000000001" as never,
              operation: "SELECT",
              naturalQuery: "ユーザーを id で取得",
              outputBinding: { name: "user" as never },
            } as never,
          ],
        },
      ],
    } as ProcessFlow;
    const rawJson = JSON.stringify(flow, null, 2);
    const issues = checkAntipatterns(flow, rawJson);
    const found = issues.filter((i) => i.code === "DB_ACCESS_SQL_REQUIRED_FOR_COMMITTED");
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("error");
    expect(found[0].path).toContain("actions[0].steps[0]");
  });
});

// ─── Check 31 (#1269 提案 C): projectIndex 渡し時の 24 prefix broken-ref 検証 ──

/**
 * 共通 helper: 期待される全 prefix を valid とする充実 index を作る。
 * 個別 test は必要に応じて差分のみ override する。
 */
function buildRichIndex() {
  return buildProjectCatalogIndex({
    screens: [
      { id: "screen-A", items: [{ id: "field-1" }, { id: "field-2" }] },
      { id: "0739c454-45d6-4c99-962a-7b0b9e113a22", items: [{ id: "searchQuery" }] },
    ],
    tables: [{ id: "users", fields: [{ name: "id" }, { name: "email" }] }],
    views: [{ id: "activeUsers", fields: [{ name: "user_id" }] }],
    viewDefinitions: [{ id: "userListViewer", columns: [{ id: "name_col" }] }],
    pageLayouts: [{ id: "main-layout" }],
    sequences: [{ id: "orderSeq" }],
    processFlows: [{ meta: { id: "flow-A" } }, { id: "flow-B" }],
    genericDefinitions: [
      { kind: "data-contract", name: "OrderForm" },
      { kind: "domain-type", name: "Order" },
      { kind: "exception-type", name: "NotFoundException" },
      { kind: "application-rule", name: "InventoryRule" },
      { kind: "validation-rule", name: "IsPositiveQuantity" },
      { kind: "ui-behavior", name: "DebounceInput" },
      { kind: "runtime-policy", name: "RetryPolicy" },
      { kind: "component-definition", name: "OrderValidator" },
      { kind: "ui-fragment", name: "OrderSummary" },
      {
        kind: "constants",
        name: "OrderConstants",
        fields: [{ name: "TAX_RATE" }, { name: "MAX_LINES" }],
      },
      { kind: "message", name: "OrderMessages", fields: [{ name: "order-confirmed" }] },
      { kind: "domain-event", name: "OrderConfirmed" },
      { kind: "log-event", name: "AuditLog", fields: [{ name: "order-created" }] },
      { kind: "log-config", name: "Default" },
    ],
    conventions: { numbering: {}, regex: {}, msg: {} },
    externalCatalogs: { externalSystems: { paymentGateway: {}, shippingApi: {} } },
    extensionNamespaces: ["retail", "common"],
  });
}

function makeFlowWithExpr(expression: string, maturity = "committed") {
  return {
    meta: {
      id: "test-flow" as never,
      name: "Test",
      flowType: "screen",
      maturity,
      createdAt: "2026-01-01" as never,
      updatedAt: "2026-01-01" as never,
    },
    actions: [
      {
        id: "action-1" as never,
        name: "Action 1",
        trigger: "click",
        steps: [
          {
            kind: "compute",
            id: "step-1",
            expression,
            description: "ref",
          } as never,
        ],
      },
    ],
  } as ProcessFlow;
}

describe("Check 31 (#1269 提案 C): projectIndex 渡し時の 24 prefix broken-ref 検証", () => {
  describe("backward compat: projectIndex 未渡し時は @var / @event 以外を silent pass", () => {
    it("@screen / @table / @const 等は projectIndex 未渡し時 silent pass (Phase X2 互換)", () => {
      const flow = makeFlowWithExpr(
        "@screen.nonexistent + @table.notInProject + @const.UNKNOWN_KEY + @msg.unknown-msg",
      );
      const rawJson = JSON.stringify(flow, null, 2);
      const issues = checkAntipatterns(flow, rawJson); // projectIndex 未渡し
      const found = issues.filter((i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE");
      expect(found).toHaveLength(0);
    });
  });

  describe("entity prefixes (階層検証)", () => {
    it("@screen.<id>: id が index にあれば valid", () => {
      const flow = makeFlowWithExpr("@screen.screen-A");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });

    it("@screen.<unknownId>: index に無ければ broken (committed=error)", () => {
      const flow = makeFlowWithExpr("@screen.unknownScreen");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found.length).toBeGreaterThan(0);
      expect(found[0].severity).toBe("error");
      expect(found[0].message).toContain("@screen.unknownScreen");
    });

    it("@screen.<id>.item.<itemId>: 階層 ref で childId 検証", () => {
      const flow = makeFlowWithExpr("@screen.screen-A.item.field-1");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });

    it("@screen.<id>.item.<unknownItem>: childId が無ければ broken", () => {
      const flow = makeFlowWithExpr("@screen.screen-A.item.unknownField");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found.length).toBeGreaterThan(0);
    });

    it("@table.<id>.field.<fieldName>: table field 検証", () => {
      const flow = makeFlowWithExpr("@table.users.field.email + @table.users.field.unknownCol");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(1);
      expect(found[0].message).toContain("@table.users.field.unknownCol");
    });

    it("@view.<id>.field.<fieldName>: view field 検証", () => {
      const flow = makeFlowWithExpr("@view.activeUsers.field.user_id");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });

    it("@viewer.<id>.column.<colId>: viewer column 検証", () => {
      const flow = makeFlowWithExpr("@viewer.userListViewer.column.name_col");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });

    it("数字始まり UUID の @screen 階層 ref も正しく検証 (#1269 提案 A の regex fix と組合せ)", () => {
      const flow = makeFlowWithExpr(
        "@screen.0739c454-45d6-4c99-962a-7b0b9e113a22.item.searchQuery",
      );
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });
  });

  describe("entity prefixes (単純 ID lookup)", () => {
    it("@layout.<id>: layouts set 突合", () => {
      const okFlow = makeFlowWithExpr("@layout.main-layout");
      const ngFlow = makeFlowWithExpr("@layout.notExist");
      const idx = buildRichIndex();
      expect(
        checkAntipatterns(okFlow, JSON.stringify(okFlow), idx).filter(
          (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
        ),
      ).toHaveLength(0);
      const ng = checkAntipatterns(ngFlow, JSON.stringify(ngFlow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(ng.length).toBeGreaterThan(0);
    });

    it("@seq / @flow / @system: 単純 set 突合", () => {
      const okFlow = makeFlowWithExpr("@seq.orderSeq + @flow.flow-A + @system.paymentGateway");
      const idx = buildRichIndex();
      const found = checkAntipatterns(okFlow, JSON.stringify(okFlow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });

    it("@seq / @flow / @system: 未知 id は broken", () => {
      const ngFlow = makeFlowWithExpr("@seq.unknownSeq + @flow.unknownFlow + @system.unknownSys");
      const idx = buildRichIndex();
      const found = checkAntipatterns(ngFlow, JSON.stringify(ngFlow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found.length).toBe(3);
    });
  });

  describe("generic-definition prefixes (14 kind)", () => {
    it.each([
      ["@contract.OrderForm", true],
      ["@contract.UnknownContract", false],
      ["@type.Order", true],
      ["@type.UnknownType", false],
      ["@exception.NotFoundException", true],
      ["@exception.UnknownException", false],
      ["@rule.InventoryRule", true],
      ["@rule.UnknownRule", false],
      ["@validation.IsPositiveQuantity", true],
      ["@validation.UnknownValidation", false],
      ["@behavior.DebounceInput", true],
      ["@behavior.UnknownBehavior", false],
      ["@policy.RetryPolicy", true],
      ["@policy.UnknownPolicy", false],
      ["@component.OrderValidator", true],
      ["@component.UnknownComponent", false],
      ["@fragment.OrderSummary", true],
      ["@fragment.UnknownFragment", false],
      ["@logConfig.Default", true],
      ["@logConfig.UnknownLogConfig", false],
    ])("`%s` → expectedValid=%s", (ref, expectedValid) => {
      const flow = makeFlowWithExpr(ref);
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      if (expectedValid) {
        expect(found).toHaveLength(0);
      } else {
        expect(found.length).toBeGreaterThan(0);
        expect(found[0].message).toContain(ref);
      }
    });
  });

  describe("@event (domain-event catalog) — Phase X2 flow-level + Phase C project-level の両 fallback", () => {
    it("flow-level context.catalogs.events に存在すれば valid (Phase X2 既存挙動)", () => {
      const flow: ProcessFlow = {
        meta: {
          id: "test-flow" as never,
          name: "Test",
          flowType: "screen",
          maturity: "committed",
          createdAt: "2026-01-01" as never,
          updatedAt: "2026-01-01" as never,
        },
        context: { catalogs: { events: { OrderShipped: { description: "X" } } } } as never,
        actions: [
          {
            id: "action-1" as never,
            name: "Action 1",
            trigger: "click",
            steps: [
              {
                kind: "compute",
                id: "step-1",
                expression: "@event.OrderShipped",
                description: "ref flow event",
              } as never,
            ],
          },
        ],
      } as ProcessFlow;
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });

    it("project-level generic-definitions/domain-event に存在すれば valid (Phase C 新規挙動)", () => {
      // flow context に events catalog なし、domain-event catalog のみで参照可能
      const flow = makeFlowWithExpr("@event.OrderConfirmed");
      const idx = buildRichIndex(); // OrderConfirmed は buildRichIndex の domain-event に登録済
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });

    it("flow / project どちらにも存在しない @event は broken", () => {
      const flow = makeFlowWithExpr("@event.UnknownEvent");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found.length).toBeGreaterThan(0);
      expect(found[0].message).toContain("@event.UnknownEvent");
    });

    it("projectIndex 未渡し時、project-level domain-event は見えない (Phase X2 互換)", () => {
      // OrderConfirmed は本来 domain-event catalog にあるが、projectIndex 未渡しなので
      // flow context.catalogs.events のみで判定 → broken
      const flow = makeFlowWithExpr("@event.OrderConfirmed");
      const found = checkAntipatterns(flow, JSON.stringify(flow)).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found.length).toBeGreaterThan(0);
    });
  });

  describe("catalog prefixes (constants / message / log-event の field 名解決)", () => {
    it("@const.<catalogName>: catalog instance 名で valid", () => {
      const flow = makeFlowWithExpr("@const.OrderConstants");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });

    it("@const.<fieldName>: catalog 内 field 名で valid (flat key 形式)", () => {
      const flow = makeFlowWithExpr("@const.TAX_RATE");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });

    it("@const.<unknownKey>: catalog name でも field 名でも無い → broken", () => {
      const flow = makeFlowWithExpr("@const.UNKNOWN_KEY");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found.length).toBeGreaterThan(0);
    });

    it("@msg.<fieldName>: message catalog field 名で valid", () => {
      const flow = makeFlowWithExpr("@msg.order-confirmed");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });

    it("@logEvent.<fieldName>: log-event catalog field 名で valid", () => {
      const flow = makeFlowWithExpr("@logEvent.order-created");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });
  });

  describe("project-level prefixes (@conv / @ext)", () => {
    it("@conv.<category>: convention category で valid", () => {
      const flow = makeFlowWithExpr("@conv.numbering.orderNumber + @conv.regex.productCode");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });

    it("@conv.<unknownCategory>: 未知 category は broken", () => {
      const flow = makeFlowWithExpr("@conv.unknownCategory.someKey");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found.length).toBeGreaterThan(0);
    });

    it("@ext.<namespace>: 既知 namespace は valid", () => {
      const flow = makeFlowWithExpr("@ext.retail.someExtension + @ext.common.helper");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });

    it("@ext.<unknownNamespace>: 未知 namespace は broken", () => {
      const flow = makeFlowWithExpr("@ext.unknownNs.something");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found.length).toBeGreaterThan(0);
    });
  });

  describe("severity (maturity 連動)", () => {
    it("maturity=draft 時、broken ref は warning", () => {
      const flow = makeFlowWithExpr("@screen.unknownScreen", "draft");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found.length).toBeGreaterThan(0);
      expect(found[0].severity).toBe("warning");
    });

    it("maturity=committed 時、broken ref は error", () => {
      const flow = makeFlowWithExpr("@screen.unknownScreen", "committed");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found.length).toBeGreaterThan(0);
      expect(found[0].severity).toBe("error");
    });
  });

  describe("error message に Phase C 拡張を示す", () => {
    it("projectIndex 渡し時、message は `project catalog 系` を含む", () => {
      const flow = makeFlowWithExpr("@screen.unknownScreen");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found[0].message).toContain("project catalog 系");
    });

    it("projectIndex 未渡し時、message は `@var / @event のみ` を含む", () => {
      const flow = makeFlowWithExpr("@var.unknownVar");
      const found = checkAntipatterns(flow, JSON.stringify(flow)).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found[0].message).toContain("のみ");
    });
  });

  describe("不明 prefix は silent pass (将来拡張のための safety)", () => {
    it("`@unknownPrefix.foo` は false positive を出さない", () => {
      const flow = makeFlowWithExpr("@somethingNew.foo");
      const idx = buildRichIndex();
      const found = checkAntipatterns(flow, JSON.stringify(flow), idx).filter(
        (i) => i.code === "BROKEN_REFERENCE_MATURITY_AWARE",
      );
      expect(found).toHaveLength(0);
    });
  });
});
