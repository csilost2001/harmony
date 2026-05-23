// #1301: thisResolver unit tests (6 件)

import { describe, expect, it } from "vitest";
import { thisResolver } from "./thisResolver";
import type { CompletionContext } from "./types";

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

describe("thisResolver", () => {
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

  it("currentDocumentKind === 'processFlow' → null (Phase A 範囲外)", () => {
    const ctxFlow: CompletionContext = {
      currentDocumentKind: "processFlow",
      currentScreenItems: screenItems,
    };
    const value = "@this.item.";
    const state = thisResolver.match(value, value.length, ctxFlow);
    expect(state).toBeNull();
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
