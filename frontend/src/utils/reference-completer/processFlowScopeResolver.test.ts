import { describe, it, expect } from "vitest";
import { stepResultResolver, inputsResolver, fieldErrorsResolver } from "./processFlowScopeResolver";
import type { CompletionContext } from "./types";
import type { ProcessFlow } from "../../types/v3";

// テスト用 ProcessFlow モック
const mockFlow: ProcessFlow = {
  meta: {
    id: "pf-test" as Parameters<typeof stepResultResolver.match>[2]["flow"] extends ProcessFlow ? ProcessFlow["meta"]["id"] : never,
    name: "テストフロー",
    kind: "screen",
    createdAt: "2026-01-01T00:00:00Z" as unknown as Parameters<typeof stepResultResolver.match>[2]["flow"] extends ProcessFlow ? ProcessFlow["meta"]["createdAt"] : never,
    updatedAt: "2026-01-01T00:00:00Z" as unknown as Parameters<typeof stepResultResolver.match>[2]["flow"] extends ProcessFlow ? ProcessFlow["meta"]["updatedAt"] : never,
  },
  actions: [
    {
      id: "act-1",
      name: "メインアクション",
      trigger: "submit",
      inputs: [
        { name: "userId", type: "string" },
        { name: "amount", type: "number" },
      ],
      steps: [
        {
          id: "validate",
          kind: "validation" as const,
          description: "入力検証",
          fieldErrorsVar: "fieldErrors" as unknown as Parameters<typeof fieldErrorsResolver.match>[2]["flow"] extends ProcessFlow ? ProcessFlow["actions"][0]["steps"][0] extends { fieldErrorsVar: infer F } ? F : never : never,
          rules: [
            { field: "userId", type: "required" },
            { field: "amount", type: "minValue", min: 0 },
          ],
        } as unknown as ProcessFlow["actions"][0]["steps"][0],
        {
          id: "fetchUser",
          kind: "dbAccess" as const,
          description: "ユーザー取得",
          operation: "SELECT",
          sql: "SELECT id, name AS userName, email AS userEmail FROM users WHERE id = @inputs.userId",
          outputBinding: {
            name: "userResult",
          },
        } as unknown as ProcessFlow["actions"][0]["steps"][0],
        {
          id: "computeTotal",
          kind: "compute" as const,
          description: "合計計算",
          outputBinding: {
            name: "totalAmount",
          },
        } as unknown as ProcessFlow["actions"][0]["steps"][0],
      ],
    },
  ],
};

const ctx = (extra: Partial<CompletionContext> = {}): CompletionContext => ({
  flow: mockFlow,
  ...extra,
});

describe("stepResultResolver", () => {
  it("ctx.flow なし → null", () => {
    const result = stepResultResolver.match("@stepResult.", 12, {});
    expect(result).toBeNull();
  });

  it("@stepResult. → stepId 補完 (全 step)", () => {
    const v = "@stepResult.";
    const result = stepResultResolver.match(v, v.length, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      const vals = result.candidates.map((c) => c.value);
      expect(vals).toContain("validate");
      expect(vals).toContain("fetchUser");
      expect(vals).toContain("computeTotal");
      // stepId 補完は trailing "." を持つ
      expect(result.candidates[0].trailing).toBe(".");
    }
  });

  it("@stepResult.fetch → prefix フィルタ", () => {
    const v = "@stepResult.fetch";
    const result = stepResultResolver.match(v, v.length, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.candidates.map((c) => c.value)).toContain("fetchUser");
    }
  });

  it("@stepResult.fetchUser. → field 補完 (outputBinding.name + SQL alias)", () => {
    const v = "@stepResult.fetchUser.";
    const result = stepResultResolver.match(v, v.length, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      const vals = result.candidates.map((c) => c.value);
      // outputBinding.name = "userResult"
      expect(vals).toContain("userResult");
      // SQL alias: userName, userEmail
      expect(vals).toContain("userName");
      expect(vals).toContain("userEmail");
    }
  });

  it("@stepResult.computeTotal. → outputBinding.name のみ", () => {
    const v = "@stepResult.computeTotal.";
    const result = stepResultResolver.match(v, v.length, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      const vals = result.candidates.map((c) => c.value);
      expect(vals).toContain("totalAmount");
    }
  });

  it("存在しない stepId → active / 候補 0 件", () => {
    const v = "@stepResult.unknown.";
    const result = stepResultResolver.match(v, v.length, ctx());
    // unknown step が見つからないため null または active 0 件
    if (result !== null && result.phase === "active") {
      expect(result.candidates).toHaveLength(0);
    } else {
      expect(result).toBeNull();
    }
  });

  it("関係ないテキスト → null", () => {
    const result = stepResultResolver.match("hello", 5, ctx());
    expect(result).toBeNull();
  });
});

describe("inputsResolver", () => {
  it("ctx.flow なし → null", () => {
    const result = inputsResolver.match("@inputs.u", 9, {});
    expect(result).toBeNull();
  });

  it("@inputs. → 全 inputs 補完", () => {
    const v = "@inputs.";
    const result = inputsResolver.match(v, v.length, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      const vals = result.candidates.map((c) => c.value);
      expect(vals).toContain("userId");
      expect(vals).toContain("amount");
    }
  });

  it("@inputs.u → prefix フィルタ", () => {
    const v = "@inputs.u";
    const result = inputsResolver.match(v, v.length, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.candidates.map((c) => c.value)).toContain("userId");
      expect(result.candidates.map((c) => c.value)).not.toContain("amount");
    }
  });

  it("関係ないテキスト → null", () => {
    expect(inputsResolver.match("hello", 5, ctx())).toBeNull();
  });
});

describe("fieldErrorsResolver", () => {
  it("ctx.flow なし → null", () => {
    expect(fieldErrorsResolver.match("@fieldErrors.", 13, {})).toBeNull();
  });

  it("@fieldErrors. → validation step の field 候補", () => {
    const v = "@fieldErrors.";
    const result = fieldErrorsResolver.match(v, v.length, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      const vals = result.candidates.map((c) => c.value);
      // fieldErrorsVar = "fieldErrors"
      expect(vals).toContain("fieldErrors");
      // rules[].field = "userId", "amount"
      expect(vals).toContain("userId");
      expect(vals).toContain("amount");
    }
  });

  it("@fieldErrors.user → prefix フィルタ", () => {
    const v = "@fieldErrors.user";
    const result = fieldErrorsResolver.match(v, v.length, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.candidates.map((c) => c.value)).toContain("userId");
    }
  });
});
