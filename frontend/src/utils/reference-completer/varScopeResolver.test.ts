// #1282: varScopeResolver unit tests
// #1302: Phase 2-bis テスト (step / tx / loop / global name 補完) 追加
// #1316: Phase 3 テスト (iterSteps nested 6 種網羅 + 4-segment 文法 + step/tx trailing)

import { describe, expect, it } from "vitest";
import { varScopeResolver } from "./varScopeResolver";
import type { CompletionContext } from "./types";
import type { ProcessFlow as V3ProcessFlow } from "../../types/v3";

// 最小限の ProcessFlow fixture (Phase 1/2 用)
const mockFlow = {
  id: "flow-1",
  name: "テストフロー",
  actions: [
    {
      id: "action-1",
      name: "処理1",
      inputs: [
        { name: "orderId", type: "string" },
        { name: "userId", type: "string" },
      ],
      steps: [
        {
          id: "step-1",
          kind: "dbAccess",
          outputBinding: { name: "orderResult" },
        },
      ],
    },
  ],
} as unknown as V3ProcessFlow;

const ctx: CompletionContext = { flow: mockFlow };

// Phase 2-bis テスト用 fixture (loop / tx / nested step 含む)
const mockFlowPhase2bis = {
  id: "flow-1",
  name: "テストフロー",
  actions: [
    {
      id: "action-1",
      name: "処理1",
      inputs: [{ name: "orderId", type: "string" }],
      steps: [
        {
          id: "step-01",
          kind: "dbAccess",
          outputBinding: { name: "userResult" },
        },
        {
          id: "step-tx-01",
          kind: "transactionScope",
          isolationLevel: "READ_COMMITTED",
          rollbackOn: [],
          outputBinding: { name: "txResult", expose: [] },
          steps: [
            {
              id: "step-02",
              kind: "dbAccess",
              outputBinding: { name: "createdOrder" },
            },
          ],
        },
        {
          id: "step-loop-01",
          kind: "loop",
          loopKind: "collection",
          collectionSource: "@var.flowParameter.cartItems",
          collectionItemName: "cartItem",
          collectionIndexName: "cartItemIdx",
          outputBinding: { name: "enrichedItems", operation: "push", initialValue: "[]" },
          steps: [
            {
              id: "step-03",
              kind: "compute",
              expression: "@var.loop.cartItem.price * @var.loop.cartItem.quantity",
              outputBinding: { name: "lineTotal" },
            },
          ],
        },
      ],
    },
  ],
} as unknown as V3ProcessFlow;

describe("varScopeResolver", () => {
  it("@var. 入力で 6 scope enum 全件候補", () => {
    const value = "@var.";
    const state = varScopeResolver.match(value, value.length, ctx);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("flowParameter");
    expect(values).toContain("action");
    expect(values).toContain("step");
    expect(values).toContain("tx");
    expect(values).toContain("loop");
    expect(values).toContain("global");
    expect(values.length).toBe(6);
  });

  it("@var.flow で prefix フィルタが効く", () => {
    const value = "@var.flow";
    const state = varScopeResolver.match(value, value.length, ctx);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0].value).toBe("flowParameter");
    expect(state.candidates[0].trailing).toBe(".");
  });

  it("@var.flowParameter. で flowParameter name 補完が返る", () => {
    const value = "@var.flowParameter.";
    const state = varScopeResolver.match(value, value.length, ctx);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("orderId");
    expect(values).toContain("userId");
  });

  it("@var.flowParameter.order で prefix フィルタが効く", () => {
    const value = "@var.flowParameter.order";
    const state = varScopeResolver.match(value, value.length, ctx);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0].value).toBe("orderId");
  });

  it("@var.action. で action outputBinding 名が候補になる", () => {
    const value = "@var.action.";
    const state = varScopeResolver.match(value, value.length, ctx);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates.map((c) => c.value)).toContain("orderResult");
  });

  // Phase 3 (#1317 review fix): action scope に nested step (TX/loop 内) の outputBinding も含む
  it("@var.action. で TX/loop 内 nested step の outputBinding.name も候補に出る (PR #1317 review fix)", () => {
    const value = "@var.action.";
    const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("userResult");      // top-level step-01
    expect(values).toContain("txResult");        // TX 自体の outputBinding
    expect(values).toContain("createdOrder");    // TX 内 nested step-02
    expect(values).toContain("enrichedItems");   // loop 自体の outputBinding
    expect(values).toContain("lineTotal");       // loop 内 nested step-03
  });

  // Phase 2-bis: step scope
  it("@var.step. で全 step id が候補になる (nested TX/loop 内含む)", () => {
    const value = "@var.step.";
    const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("step-01");
    expect(values).toContain("step-tx-01");
    expect(values).toContain("step-02"); // TX 内 nested
    expect(values).toContain("step-loop-01");
    expect(values).toContain("step-03"); // loop 内 nested
    expect(values.length).toBe(5);
  });

  it("@var.step.step- で prefix フィルタが効く", () => {
    const value = "@var.step.step-";
    const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    // "step-01", "step-tx-01", "step-02", "step-loop-01", "step-03" は全て "step-" で始まる
    expect(values.length).toBe(5);
    values.forEach((v) => expect(v.startsWith("step-")).toBe(true));
  });

  it("@var.step.foo で候補なし (foo 始まりの step id がない)", () => {
    const value = "@var.step.foo";
    const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(0);
  });

  // Phase 2-bis: tx scope
  it("@var.tx. で kind=transactionScope の id のみ候補になる", () => {
    const value = "@var.tx.";
    const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("step-tx-01");
    // 通常 step / loop step は含まれない
    expect(values).not.toContain("step-01");
    expect(values).not.toContain("step-loop-01");
    expect(values.length).toBe(1);
  });

  // Phase 2-bis: loop scope
  it("@var.loop. で loop の collectionItemName / collectionIndexName / outputBinding.name が候補になる", () => {
    const value = "@var.loop.";
    const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("cartItem");       // collectionItemName
    expect(values).toContain("cartItemIdx");    // collectionIndexName
    expect(values).toContain("enrichedItems"); // outputBinding.name
    expect(values.length).toBe(3);
  });

  // #1310: global scope (catalog 駆動)
  describe("@var.global.<name> (catalog driven、#1310)", () => {
    it("genericDefinitionsByKind 未渡しで空候補 (active mode 維持)", () => {
      const value = "@var.global.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      expect(state.candidates).toHaveLength(0);
    });

    it("global catalog 渡しで name 候補が返る", () => {
      const value = "@var.global.";
      const state = varScopeResolver.match(value, value.length, {
        flow: mockFlowPhase2bis,
        genericDefinitionsByKind: {
          global: [{ name: "TenantContext" }, { name: "FeatureFlags" }],
        },
      });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      const values = state.candidates.map((c) => c.value);
      expect(values).toContain("TenantContext");
      expect(values).toContain("FeatureFlags");
      expect(values.length).toBe(2);
    });

    it("@var.global.Ten で prefix フィルタが効く", () => {
      const value = "@var.global.Ten";
      const state = varScopeResolver.match(value, value.length, {
        flow: mockFlowPhase2bis,
        genericDefinitionsByKind: {
          global: [{ name: "TenantContext" }, { name: "FeatureFlags" }],
        },
      });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      expect(state.candidates).toHaveLength(1);
      expect(state.candidates[0].value).toBe("TenantContext");
    });
  });

  // Phase 3 (#1316): step / tx 候補に trailing: "." 付与 (4-segment 文法連動)
  describe("Phase 3 (#1316) — step/tx 候補の trailing", () => {
    it("@var.step. の各候補に trailing: \".\" が付く", () => {
      const value = "@var.step.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      expect(state.candidates.length).toBeGreaterThan(0);
      state.candidates.forEach((c) => expect(c.trailing).toBe("."));
    });

    it("@var.tx. の候補に trailing: \".\" が付く", () => {
      const value = "@var.tx.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      expect(state.candidates.length).toBeGreaterThan(0);
      state.candidates.forEach((c) => expect(c.trailing).toBe("."));
    });

    it("@var.loop. の候補には trailing が付かない (3-segment で完結)", () => {
      const value = "@var.loop.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      expect(state.candidates.length).toBeGreaterThan(0);
      state.candidates.forEach((c) => expect(c.trailing).toBeUndefined());
    });

    it("@var.flowParameter. の候補にも trailing が付かない", () => {
      const value = "@var.flowParameter.";
      const state = varScopeResolver.match(value, value.length, ctx);
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      expect(state.candidates.length).toBeGreaterThan(0);
      state.candidates.forEach((c) => expect(c.trailing).toBeUndefined());
    });
  });

  // Phase 3 (#1316): iterSteps の nested 6 種網羅
  // workflow / TX.onCommit / TX.onRollback / branch.elseBranch / validation.inlineBranch
  describe("Phase 3 (#1316) — iterSteps nested 網羅", () => {
    const mockFlowPhase3Nested = {
      id: "flow-3",
      name: "phase3 nested",
      actions: [
        {
          id: "action-1",
          name: "compound nesting",
          inputs: [],
          steps: [
            // TX.onCommit / onRollback 内 step
            {
              id: "tx-01",
              kind: "transactionScope",
              isolationLevel: "READ_COMMITTED",
              rollbackOn: [],
              steps: [{ id: "in-tx-body", kind: "dbAccess" }],
              onCommit: [{ id: "in-tx-oncommit", kind: "log", message: "ok" }],
              onRollback: [{ id: "in-tx-onrollback", kind: "log", message: "ng" }],
            },
            // branch.elseBranch 内 step
            {
              id: "branch-01",
              kind: "branch",
              description: "if-else",
              branches: [
                {
                  id: "br-A",
                  code: "A",
                  condition: { kind: "expression", expression: "true" },
                  steps: [{ id: "in-branch-a", kind: "dbAccess" }],
                },
              ],
              elseBranch: {
                id: "br-X",
                code: "X",
                steps: [{ id: "in-else-branch", kind: "log", message: "else" }],
              },
            },
            // workflow.on{Approved,Rejected,Timeout} 内 step
            {
              id: "wf-01",
              kind: "workflow",
              description: "approval",
              pattern: "approval-sequential",
              approvers: [{ role: "manager" }],
              onApproved: [{ id: "in-wf-approved", kind: "log", message: "ok" }],
              onRejected: [{ id: "in-wf-rejected", kind: "log", message: "ng" }],
              onTimeout: [{ id: "in-wf-timeout", kind: "log", message: "tm" }],
            },
            // validation.inlineBranch.{ok,ng} 内 step
            {
              id: "val-01",
              kind: "validation",
              description: "validate",
              fieldErrorsVar: "fieldErrors",
              inlineBranch: {
                ok: [{ id: "in-val-ok", kind: "dbAccess" }],
                ng: [{ id: "in-val-ng", kind: "log", message: "ng" }],
              },
            },
          ],
        },
      ],
    } as unknown as V3ProcessFlow;

    it("@var.step. で TX.onCommit / onRollback 内 step id が候補に出る", () => {
      const value = "@var.step.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase3Nested });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      const values = state.candidates.map((c) => c.value);
      expect(values).toContain("in-tx-body");
      expect(values).toContain("in-tx-oncommit");
      expect(values).toContain("in-tx-onrollback");
    });

    it("@var.step. で branch.elseBranch 内 step id が候補に出る", () => {
      const value = "@var.step.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase3Nested });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      const values = state.candidates.map((c) => c.value);
      expect(values).toContain("in-branch-a");
      expect(values).toContain("in-else-branch");
    });

    it("@var.step. で workflow.on{Approved,Rejected,Timeout} 内 step id が候補に出る", () => {
      const value = "@var.step.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase3Nested });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      const values = state.candidates.map((c) => c.value);
      expect(values).toContain("in-wf-approved");
      expect(values).toContain("in-wf-rejected");
      expect(values).toContain("in-wf-timeout");
    });

    it("@var.step. で validation.inlineBranch.{ok,ng} 内 step id が候補に出る", () => {
      const value = "@var.step.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase3Nested });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      const values = state.candidates.map((c) => c.value);
      expect(values).toContain("in-val-ok");
      expect(values).toContain("in-val-ng");
    });
  });

  // Phase 3 (#1316): 4-segment 文法 @var.step.<id>.<binding-name>
  describe("Phase 3 (#1316) — 4-segment @var.step.<id>.<name>", () => {
    it("@var.step.step-01. で該当 step の outputBinding.name が候補になる", () => {
      const value = "@var.step.step-01.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      const values = state.candidates.map((c) => c.value);
      expect(values).toContain("userResult"); // step-01.outputBinding.name
      expect(values.length).toBe(1);
    });

    it("@var.step.step-02. (TX 内 nested step) でも outputBinding.name が候補になる", () => {
      const value = "@var.step.step-02.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      const values = state.candidates.map((c) => c.value);
      expect(values).toContain("createdOrder"); // step-02 (TX 内).outputBinding.name
    });

    it("@var.step.step-01.user で prefix フィルタが効く", () => {
      const value = "@var.step.step-01.user";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      const values = state.candidates.map((c) => c.value);
      expect(values).toContain("userResult");
    });

    it("@var.step.<存在しない id>. で空候補 (該当 step なし)", () => {
      const value = "@var.step.nonexistent.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      expect(state.candidates).toHaveLength(0);
    });
  });

  // Phase 3 (#1316): 4-segment 文法 @var.tx.<id>.<member>
  describe("Phase 3 (#1316) — 4-segment @var.tx.<id>.<member>", () => {
    const mockFlowPhase3Tx = {
      id: "flow-3-tx",
      name: "phase3 tx with expose",
      actions: [
        {
          id: "action-1",
          name: "tx with expose",
          inputs: [],
          steps: [
            {
              id: "tx-with-expose",
              kind: "transactionScope",
              isolationLevel: "READ_COMMITTED",
              rollbackOn: [],
              outputBinding: { name: "txResult", expose: ["newOrderId", "stockReserved"] },
              steps: [
                { id: "tx-child-01", kind: "dbAccess", outputBinding: { name: "newOrderId" } },
              ],
            },
            // 非 TX step (tx scope ではマッチしないことを確認)
            { id: "not-tx-step", kind: "dbAccess", outputBinding: { name: "x" } },
          ],
        },
      ],
    } as unknown as V3ProcessFlow;

    it("@var.tx.tx-with-expose. で予約 3 値 + expose[] が候補になる", () => {
      const value = "@var.tx.tx-with-expose.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase3Tx });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      const values = state.candidates.map((c) => c.value);
      expect(values).toContain("committed");
      expect(values).toContain("error");
      expect(values).toContain("diagnostics");
      expect(values).toContain("newOrderId");
      expect(values).toContain("stockReserved");
      expect(values.length).toBe(5);
    });

    it("@var.tx.tx-with-expose.comm で prefix フィルタが効く", () => {
      const value = "@var.tx.tx-with-expose.comm";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase3Tx });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      const values = state.candidates.map((c) => c.value);
      expect(values).toContain("committed");
      expect(values.length).toBe(1);
    });

    it("@var.tx.not-tx-step. (非 TX step を tx scope で指定) は空候補", () => {
      const value = "@var.tx.not-tx-step.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase3Tx });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      expect(state.candidates).toHaveLength(0);
    });

    it("@var.tx.<存在しない id>. でも空候補", () => {
      const value = "@var.tx.nonexistent.";
      const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase3Tx });
      expect(state?.phase).toBe("active");
      if (state?.phase !== "active") return;
      expect(state.candidates).toHaveLength(0);
    });
  });
});
