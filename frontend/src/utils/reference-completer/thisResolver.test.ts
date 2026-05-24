// #1301 Phase A + #1308 Phase B: thisResolver unit tests

import { describe, expect, it } from "vitest";
import { thisResolver } from "./thisResolver";
import type { CompletionContext } from "./types";
import type { ProcessFlow } from "../../types/v3";

const screenItems = [
  { id: "username", label: "ユーザー名" },
  { id: "password", label: "パスワード" },
  { id: "loginButton", label: "ログインボタン" },
];

const ctxScreen: CompletionContext = {
  currentDocumentKind: "screen",
  currentScreenItems: screenItems,
  currentScreenId: "login-screen",
};

describe("thisResolver — Phase A: Screen editor", () => {
  it("@this.item. (空 prefix) → 全 currentScreenItems が候補", () => {
    const value = "@this.item.";
    const state = thisResolver.match(value, value.length, ctxScreen);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.resolverId).toBe("this");
    expect(state.candidates).toHaveLength(3);
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("username");
    expect(values).toContain("password");
    expect(values).toContain("loginButton");
  });

  it("@this.item.us (部分 prefix) → username のみ候補", () => {
    const value = "@this.item.us";
    const state = thisResolver.match(value, value.length, ctxScreen);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0].value).toBe("username");
    expect(state.candidates[0].label).toBe("ユーザー名");
    expect(state.prefix).toBe("us");
    expect(state.replaceLen).toBe(2);
  });

  it("@this.item.xxx (マッチなし) → 空 candidates", () => {
    const value = "@this.item.xxx";
    const state = thisResolver.match(value, value.length, ctxScreen);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(0);
  });

  it("@this. (空 prefix) → top-level fields (id/name/purpose/item) 候補", () => {
    const value = "@this.";
    const state = thisResolver.match(value, value.length, ctxScreen);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("id");
    expect(values).toContain("name");
    expect(values).toContain("purpose");
    expect(values).toContain("item");
    // item は trailing "." を持つ
    const itemCandidate = state.candidates.find((c) => c.value === "item");
    expect(itemCandidate?.trailing).toBe(".");
  });

  it("currentDocumentKind 未設定 → null", () => {
    const ctxEmpty: CompletionContext = {
      currentScreenItems: screenItems,
    };
    const value = "@this.item.";
    const state = thisResolver.match(value, value.length, ctxEmpty);
    expect(state).toBeNull();
  });
});

describe("thisResolver — Phase B: ProcessFlow editor", () => {
  const flow: Partial<ProcessFlow> = {
    actions: [
      { id: "submitOrder", name: "注文確定", trigger: { kind: "screen-item-event" } as never, steps: [] },
      { id: "cancelOrder", name: "注文キャンセル", trigger: { kind: "screen-item-event" } as never, steps: [] },
    ] as never,
  };

  const ctxFlow: CompletionContext = {
    currentDocumentKind: "processFlow",
    flow: flow as ProcessFlow,
  };

  it("@this.action. → 全 action 候補", () => {
    const value = "@this.action.";
    const state = thisResolver.match(value, value.length, ctxFlow);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(2);
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("submitOrder");
    expect(values).toContain("cancelOrder");
    const submit = state.candidates.find((c) => c.value === "submitOrder");
    expect(submit?.label).toBe("注文確定");
  });

  it("@this.action.sub (部分 prefix) → submitOrder のみ候補", () => {
    const value = "@this.action.sub";
    const state = thisResolver.match(value, value.length, ctxFlow);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0].value).toBe("submitOrder");
    expect(state.prefix).toBe("sub");
  });

  it("@this. → ProcessFlow top-level fields (meta/context/action/expressionLanguage)", () => {
    // ProcessFlow は EntityMeta を継承せず root に meta nested。
    // id / name / flowType 等は @this.meta.<field> 経由 (S-1 review fix、2026-05-24)。
    const value = "@this.";
    const state = thisResolver.match(value, value.length, ctxFlow);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("meta");
    expect(values).toContain("context");
    expect(values).toContain("action");
    expect(values).toContain("expressionLanguage");
    // 旧 Phase A 風 flat field は ProcessFlow には存在しない
    expect(values).not.toContain("id");
    expect(values).not.toContain("name");
    expect(values).not.toContain("flowType");
    const actionCandidate = state.candidates.find((c) => c.value === "action");
    expect(actionCandidate?.trailing).toBe(".");
    const metaCandidate = state.candidates.find((c) => c.value === "meta");
    expect(metaCandidate?.trailing).toBe(".");
  });
});

describe("thisResolver — Phase B: 他 kind top-level fields", () => {
  it("table → field を含む top-level", () => {
    const ctxTable: CompletionContext = { currentDocumentKind: "table" };
    const state = thisResolver.match("@this.", "@this.".length, ctxTable);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("id");
    expect(values).toContain("name");
    expect(values).toContain("physicalName");
    expect(values).toContain("field");
    const fieldCandidate = state.candidates.find((c) => c.value === "field");
    expect(fieldCandidate?.trailing).toBe(".");
  });

  it("view → outputColumn を含む top-level", () => {
    const ctxView: CompletionContext = { currentDocumentKind: "view" };
    const state = thisResolver.match("@this.", "@this.".length, ctxView);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("id");
    expect(values).toContain("physicalName");
    expect(values).toContain("outputColumn");
  });

  it("viewDefinition → column を含む top-level", () => {
    const ctxVd: CompletionContext = { currentDocumentKind: "viewDefinition" };
    const state = thisResolver.match("@this.", "@this.".length, ctxVd);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("id");
    expect(values).toContain("kind");
    expect(values).toContain("column");
  });

  it("sequence → startValue / increment / cycle 等の field を含む top-level", () => {
    const ctxSeq: CompletionContext = { currentDocumentKind: "sequence" };
    const state = thisResolver.match("@this.", "@this.".length, ctxSeq);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("id");
    expect(values).toContain("startValue");
    expect(values).toContain("increment");
    expect(values).toContain("cycle");
    // sequence は collection field を持たない
    expect(values).not.toContain("step");
    expect(values).not.toContain("action");
  });

  it("pageLayout → region を含む top-level", () => {
    const ctxPl: CompletionContext = { currentDocumentKind: "pageLayout" };
    const state = thisResolver.match("@this.", "@this.".length, ctxPl);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("id");
    expect(values).toContain("region");
    const regionCandidate = state.candidates.find((c) => c.value === "region");
    expect(regionCandidate?.trailing).toBe(".");
  });
});

describe("thisResolver — collection 補完は data 無いと候補 0", () => {
  it("processFlow editor で flow が無い → action 補完は空候補", () => {
    const ctxNoFlow: CompletionContext = { currentDocumentKind: "processFlow" };
    const state = thisResolver.match("@this.action.", "@this.action.".length, ctxNoFlow);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(0);
  });
});
