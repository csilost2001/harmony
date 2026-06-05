// #1282: screenHierarchicalResolver unit tests (5 件)

import { describe, expect, it } from "vitest";
import { screenHierarchicalResolver } from "./screenHierarchicalResolver";
import type { CompletionContext } from "./types";

const ctx: CompletionContext = {
  workspace: {
    screens: [
      { id: "login-screen", name: "ログイン画面", maturity: "committed" },
      { id: "order-list", name: "注文一覧", maturity: "draft" },
      { id: "order-detail", name: "注文詳細", maturity: "draft" },
    ],
    tables: [],
    viewDefinitions: [],
    processFlows: [],
    components: [],
    exceptionTypes: [],
    modelEndpoints: [],
    secrets: [],
    events: [],
  },
  currentScreenId: "login-screen",
  currentScreenItems: [
    { id: "username", label: "ユーザー名" },
    { id: "password", label: "パスワード" },
    { id: "loginButton", label: "ログインボタン" },
  ],
};

describe("screenHierarchicalResolver", () => {
  it("@screen. 入力時に全 screens を候補として返す", () => {
    const value = "@screen.";
    const state = screenHierarchicalResolver.match(value, value.length, ctx);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(3);
    expect(state.candidates.map((c) => c.value)).toContain("login-screen");
    expect(state.candidates[0].trailing).toBe(".item.");
  });

  it("@screen.order で prefix フィルタが効く", () => {
    const value = "@screen.order";
    const state = screenHierarchicalResolver.match(value, value.length, ctx);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("order-list");
    expect(values).toContain("order-detail");
    expect(values).not.toContain("login-screen");
  });

  it("@screen.login-screen.item. で現画面の items が候補になる", () => {
    const value = "@screen.login-screen.item.";
    const state = screenHierarchicalResolver.match(value, value.length, ctx);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    const values = state.candidates.map((c) => c.value);
    expect(values).toContain("username");
    expect(values).toContain("password");
    expect(values).toContain("loginButton");
  });

  it("@screen.login-screen.item.user で prefix フィルタが効く", () => {
    const value = "@screen.login-screen.item.user";
    const state = screenHierarchicalResolver.match(value, value.length, ctx);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    expect(state.candidates).toHaveLength(1);
    expect(state.candidates[0].value).toBe("username");
    expect(state.candidates[0].label).toBe("ユーザー名");
  });

  it("他画面 (order-list) の items は空候補になる", () => {
    const value = "@screen.order-list.item.";
    const state = screenHierarchicalResolver.match(value, value.length, ctx);
    expect(state?.phase).toBe("active");
    if (state?.phase !== "active") return;
    // 他画面は未ロードのため空候補
    expect(state.candidates).toHaveLength(0);
  });
});
