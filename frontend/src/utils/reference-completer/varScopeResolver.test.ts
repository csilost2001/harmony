// #1282: varScopeResolver unit tests
// #1302: Phase 2-bis テスト (step / tx / loop / global name 補完) 追加

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

  // Phase 2-bis: global scope (空候補)
  it("@var.global. で空候補 (catalog 未確立、phase active のまま)", () => {
    const value = "@var.global.";
    const state = varScopeResolver.match(value, value.length, { flow: mockFlowPhase2bis });
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(0);
  });
});
