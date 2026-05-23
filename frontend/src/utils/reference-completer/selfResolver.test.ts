// #1301: selfResolver unit tests (5 件)

import { describe, expect, it } from "vitest";
import { selfResolver } from "./selfResolver";
import type { CompletionContext } from "./types";

const ctxScreenItem: CompletionContext = {
  currentSelfRef: { kind: "screenItem", id: "username" },
};

describe("selfResolver", () => {
  it("@self. (空 prefix) → ScreenItem fields 全候補", () => {
    const value = "@self.";
    const state = selfResolver.match(value, value.length, ctxScreenItem);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.resolverId).toBe("self");
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("id");
    expect(values).toContain("label");
    expect(values).toContain("value");
    expect(values).toContain("readonly");
    expect(values).toContain("enabled");
    expect(values).toContain("visible");
    expect(values).toContain("errors");
    expect(values).toContain("options");
  });

  it("@self.va (部分 prefix) → value 候補のみ", () => {
    const value = "@self.va";
    const state = selfResolver.match(value, value.length, ctxScreenItem);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0].value).toBe("value");
    expect(state.prefix).toBe("va");
    expect(state.replaceLen).toBe(2);
  });

  it("@self.xxx (マッチなし) → 空 candidates", () => {
    const value = "@self.xxx";
    const state = selfResolver.match(value, value.length, ctxScreenItem);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(0);
  });

  it("currentSelfRef.kind === 'step' → null (Phase A 範囲外)", () => {
    const ctxStep: CompletionContext = {
      currentSelfRef: { kind: "step", id: "step-01" },
    };
    const value = "@self.";
    const state = selfResolver.match(value, value.length, ctxStep);
    expect(state).toBeNull();
  });

  it("currentSelfRef 未設定 → null", () => {
    const ctxEmpty: CompletionContext = {};
    const value = "@self.";
    const state = selfResolver.match(value, value.length, ctxEmpty);
    expect(state).toBeNull();
  });
});
