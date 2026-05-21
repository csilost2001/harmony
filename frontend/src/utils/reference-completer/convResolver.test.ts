import { describe, it, expect } from "vitest";
import { convResolver } from "./convResolver";
import type { CompletionContext } from "./types";
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";

const catalog: ConventionsCatalog = {
  version: "1.0.0",
  msg: { required: { template: "{label}は必須入力です" } },
  regex: { "email-simple": { pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" } },
  limit: { nameMax: { value: 100, unit: "char" } },
  scope: { customerRegion: { value: "domestic" } },
  currency: { jpy: { code: "JPY" }, usd: { code: "USD" } },
  tax: { standard: { kind: "exclusive", rate: 0.1 } },
  auth: { default: { scheme: "session-cookie" } },
  db: { default: { engine: "postgresql@14" } },
  numbering: { customerCode: { format: "C-NNNN" }, orderNumber: { format: "ORD-YYYY-NNNN" } },
  tx: { singleOperation: { policy: "1 TX" } },
  externalOutcomeDefaults: {
    success: { outcome: "success", action: "continue" },
    failure: { outcome: "failure", action: "abort" },
  },
};

const ctx = (conventions: ConventionsCatalog | null = catalog): CompletionContext => ({
  conventions,
});

describe("convResolver", () => {
  it("conventions が null → null を返す", () => {
    const result = convResolver.match("@conv.", 6, ctx(null));
    expect(result).toBeNull();
  });

  it("@conv. → active / category 全 11 候補", () => {
    const v = "@conv.";
    const result = convResolver.match(v, v.length, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.candidates).toHaveLength(11);
      expect(result.resolverId).toBe("conv");
      expect(result.prefix).toBe("");
      // category 補完は trailing "." を持つ
      expect(result.candidates[0].trailing).toBe(".");
    }
  });

  it("@conv.curre → 1 候補 (currency)", () => {
    const v = "@conv.curre";
    const result = convResolver.match(v, v.length, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.candidates.map((c) => c.value)).toEqual(["currency"]);
      expect(result.prefix).toBe("curre");
    }
  });

  it("@conv.currency. → key phase / 全キー", () => {
    const v = "@conv.currency.";
    const result = convResolver.match(v, v.length, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      const vals = result.candidates.map((c) => c.value);
      expect(vals).toContain("jpy");
      expect(vals).toContain("usd");
      expect(result.prefix).toBe("");
      // key 補完は trailing なし
      expect(result.candidates[0].trailing).toBeUndefined();
    }
  });

  it("@conv.currency.j → prefix 'j' でフィルタ", () => {
    const v = "@conv.currency.j";
    const result = convResolver.match(v, v.length, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.candidates.map((c) => c.value)).toEqual(["jpy"]);
    }
  });

  it("@conv.unknown. → null (catalog にないカテゴリ)", () => {
    const v = "@conv.unknown.";
    const result = convResolver.match(v, v.length, ctx());
    // 候補 0 件 か null かどちらかで idle 相当であること
    if (result !== null && result.phase === "active") {
      expect(result.candidates).toHaveLength(0);
    } else {
      expect(result).toBeNull();
    }
  });

  it("関係ないテキスト → null", () => {
    const v = "Math.floor(subtotal * 0.10)";
    const result = convResolver.match(v, v.length, ctx());
    expect(result).toBeNull();
  });

  it("文中 @conv.msg.req でカーソルが 'req' 末尾 → active", () => {
    const v = "foo @conv.msg.req bar";
    const cursor = "foo @conv.msg.req".length;
    const result = convResolver.match(v, cursor, ctx());
    expect(result?.phase).toBe("active");
    if (result?.phase === "active") {
      expect(result.candidates.map((c) => c.value)).toContain("required");
    }
  });
});
