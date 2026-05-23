// #1282: varScopeResolver unit tests (5 件)

import { describe, expect, it } from "vitest";
import { varScopeResolver } from "./varScopeResolver";
import type { CompletionContext } from "./types";
import type { ProcessFlow as V3ProcessFlow } from "../../types/v3";

// 最小限の ProcessFlow fixture
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

  // S-3: Phase 1 範囲固定 — step / tx の name 補完は Phase 2-bis 未対応
  it("@var.step.<id> name 補完は Phase 2-bis 未対応のため候補なし", () => {
    const value = "@var.step.foo";
    const state = varScopeResolver.match(value, value.length, { flow: mockFlow });
    // Phase 2 regex は (flowParameter|action) 限定のため null
    expect(state).toBeNull();
  });

  it("@var.tx.<id> name 補完も Phase 2-bis 未対応のため候補なし", () => {
    const value = "@var.tx.bar";
    const state = varScopeResolver.match(value, value.length, { flow: mockFlow });
    expect(state).toBeNull();
  });
});
