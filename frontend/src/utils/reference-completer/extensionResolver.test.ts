import { describe, it, expect } from "vitest";
import { extensionResolver } from "./extensionResolver";
import type { CompletionContext } from "./types";
import type { LoadedExtensions } from "../../schemas/loadExtensions";

const mockExtensions: LoadedExtensions = {
  steps: {
    "myns:SendEmail": {
      label: "メール送信",
      icon: "bi-envelope",
      description: "メールを送信する",
      schema: {},
    },
    "myns:Notify": {
      label: "通知",
      icon: "bi-bell",
      description: "通知を送信する",
      schema: {},
    },
    "globalStep": {
      label: "グローバル step",
      icon: "bi-play",
      description: "namespace なし",
      schema: {},
    },
  },
  triggers: [
    { value: "myns:webhook", label: "Webhook" },
    { value: "click", label: "クリック" }, // namespace なし → スキップ
  ],
  fieldTypes: [
    { kind: "myns:customField", label: "カスタムフィールド" },
  ],
  dbOperations: [
    { value: "myns:UPSERT", label: "UPSERT" },
    { value: "SELECT", label: "SELECT" }, // namespace なし → スキップ
  ],
  responseTypes: {
    "myns:PaginatedList": {
      schema: { type: "object" },
    },
    "Success": {
      schema: { type: "object" },
    }, // namespace なし → スキップ
  },
};

const ctx = (extra: Partial<CompletionContext> = {}): CompletionContext => ({
  fieldKind: "extensionRef",
  extensions: mockExtensions,
  ...extra,
});

describe("extensionResolver", () => {
  it("fieldKind='extensionRef' + extensions → namespace:kind 形式の候補", () => {
    const result = extensionResolver.match("", 0, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      const vals = result.candidates.map((c) => c.value);
      // namespace 付きのみ含む
      expect(vals).toContain("myns:SendEmail");
      expect(vals).toContain("myns:Notify");
      expect(vals).toContain("myns:webhook");
      expect(vals).toContain("myns:UPSERT");
      expect(vals).toContain("myns:PaginatedList");
      // namespace なしは含まない
      expect(vals).not.toContain("globalStep");
      expect(vals).not.toContain("click");
      expect(vals).not.toContain("SELECT");
      expect(vals).not.toContain("Success");
    }
  });

  it("prefix フィルタ (myns:Send で絞り込み)", () => {
    const result = extensionResolver.match("myns:Send", 9, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.candidates.map((c) => c.value)).toContain("myns:SendEmail");
      expect(result.candidates.map((c) => c.value)).not.toContain("myns:Notify");
    }
  });

  it("hint に label が含まれる", () => {
    const result = extensionResolver.match("myns:SendEmail", 14, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      const found = result.candidates.find((c) => c.value === "myns:SendEmail");
      expect(found?.hint).toBe("メール送信");
    }
  });

  it("fieldKind 不一致 → null", () => {
    const result = extensionResolver.match("", 0, { ...ctx(), fieldKind: "other" });
    expect(result).toBeNull();
  });

  it("extensions なし → null", () => {
    const result = extensionResolver.match("", 0, { fieldKind: "extensionRef" });
    expect(result).toBeNull();
  });

  it("重複は除去される (steps / responseTypes の同キー)", () => {
    const extWithDup: LoadedExtensions = {
      ...mockExtensions,
      steps: { "myns:SendEmail": mockExtensions.steps["myns:SendEmail"] },
      responseTypes: { "myns:SendEmail": { schema: {} } }, // 重複
    };
    const result = extensionResolver.match("", 0, { fieldKind: "extensionRef", extensions: extWithDup });
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      const matches = result.candidates.filter((c) => c.value === "myns:SendEmail");
      expect(matches).toHaveLength(1);
    }
  });
});
