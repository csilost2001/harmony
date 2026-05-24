// #1301 Phase A + #1308 Phase B: selfResolver unit tests

import { describe, expect, it } from "vitest";
import { selfResolver } from "./selfResolver";
import type { CompletionContext } from "./types";

const ctxScreenItem: CompletionContext = {
  currentSelfRef: { kind: "screenItem", id: "username" },
};

describe("selfResolver — Phase A: ScreenItem context", () => {
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

  it("currentSelfRef 未設定 → null", () => {
    const ctxEmpty: CompletionContext = {};
    const value = "@self.";
    const state = selfResolver.match(value, value.length, ctxEmpty);
    expect(state).toBeNull();
  });
});

describe("selfResolver — Phase B: step kind (ProcessFlow editor)", () => {
  const ctxStep: CompletionContext = {
    currentSelfRef: { kind: "step", id: "step-01" },
  };

  it("@self. → Step base fields 候補", () => {
    const state = selfResolver.match("@self.", "@self.".length, ctxStep);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("id");
    expect(values).toContain("description");
    expect(values).toContain("runIf");
    expect(values).toContain("outputBinding");
    expect(values).toContain("compensatesFor");
    // screenItem 専用 field は含まない
    expect(values).not.toContain("label");
    expect(values).not.toContain("readonly");
  });

  it("@self.out → outputBinding のみ", () => {
    const state = selfResolver.match("@self.out", "@self.out".length, ctxStep);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0].value).toBe("outputBinding");
  });
});

describe("selfResolver — Phase B: column kind (Table/View editor)", () => {
  const ctxColumn: CompletionContext = {
    currentSelfRef: { kind: "column", id: "col-01" },
  };

  it("@self. → Column fields 候補", () => {
    const state = selfResolver.match("@self.", "@self.".length, ctxColumn);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("id");
    expect(values).toContain("physicalName");
    expect(values).toContain("name");
    expect(values).toContain("dataType");
    expect(values).toContain("notNull");
    expect(values).toContain("primaryKey");
    expect(values).toContain("defaultValue");
    expect(values).toContain("comment");
  });

  it("@self.phys → physicalName のみ", () => {
    const state = selfResolver.match("@self.phys", "@self.phys".length, ctxColumn);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0].value).toBe("physicalName");
  });
});

describe("selfResolver — Phase B: region kind (PageLayout editor)", () => {
  const ctxRegion: CompletionContext = {
    currentSelfRef: { kind: "region", id: "main" },
  };

  it("@self. → Region fields 候補 (name / description)", () => {
    const state = selfResolver.match("@self.", "@self.".length, ctxRegion);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("name");
    expect(values).toContain("description");
    expect(values).toHaveLength(2);
  });
});

describe("selfResolver — fields override", () => {
  it("currentSelfRef.fields が明示指定されたら default を上書き", () => {
    const ctxOverride: CompletionContext = {
      currentSelfRef: {
        kind: "step",
        id: "step-01",
        fields: [{ name: "customField", label: "カスタム" }],
      },
    };
    const state = selfResolver.match("@self.", "@self.".length, ctxOverride);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0].value).toBe("customField");
  });
});
