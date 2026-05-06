import { describe, it, expect } from "vitest";
import { computeCompletion, insertCandidate } from "./useConvCompletion";
import type { ConventionsCatalog } from "../schemas/conventionsValidator";

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

describe("computeCompletion", () => {
  it("catalog が null → idle", () => {
    expect(computeCompletion("@conv.", 6, null)).toEqual({ phase: "idle" });
  });

  it("@conv. → category phase / 全 11 候補", () => {
    const r = computeCompletion("@conv.", 6, catalog);
    expect(r.phase).toBe("category");
    if (r.phase === "category") {
      expect(r.candidates).toHaveLength(11);
      expect(r.prefix).toBe("");
    }
  });

  it("@conv.curre → category phase / 1 候補 (currency)", () => {
    const v = "@conv.curre";
    const r = computeCompletion(v, v.length, catalog);
    expect(r.phase).toBe("category");
    if (r.phase === "category") {
      expect(r.candidates).toEqual(["currency"]);
      expect(r.prefix).toBe("curre");
    }
  });

  it("@conv.currency. → key phase / catalog.currency の全キー", () => {
    const v = "@conv.currency.";
    const r = computeCompletion(v, v.length, catalog);
    expect(r.phase).toBe("key");
    if (r.phase === "key") {
      expect(r.candidates).toContain("jpy");
      expect(r.candidates).toContain("usd");
      expect(r.prefix).toBe("");
    }
  });

  it("@conv.currency.j → key phase / prefix 'j' でフィルタ", () => {
    const v = "@conv.currency.j";
    const r = computeCompletion(v, v.length, catalog);
    expect(r.phase).toBe("key");
    if (r.phase === "key") {
      expect(r.candidates).toEqual(["jpy"]);
      expect(r.prefix).toBe("j");
    }
  });

  it("文中 @conv.msg.req でカーソルが 'req' 末尾 → key phase / msg カテゴリ", () => {
    const v = "foo @conv.msg.req bar";
    const cursor = "foo @conv.msg.req".length;
    const r = computeCompletion(v, cursor, catalog);
    expect(r.phase).toBe("key");
    if (r.phase === "key") {
      expect(r.category).toBe("msg");
      expect(r.candidates).toEqual(["required"]);
    }
  });

  it("@conv.unknown. → idle (catalog に存在しないカテゴリ)", () => {
    const v = "@conv.unknown.";
    const r = computeCompletion(v, v.length, catalog);
    expect(r.phase).toBe("idle");
  });

  it("@conv だけで '.' がない → category phase / prefix ''", () => {
    const v = "@conv";
    const r = computeCompletion(v, v.length, catalog);
    expect(r.phase).toBe("category");
  });

  it("関係ないテキスト → idle", () => {
    const v = "Math.floor(subtotal * 0.10)";
    const r = computeCompletion(v, v.length, catalog);
    expect(r.phase).toBe("idle");
  });

  it("scope / tax / auth / db / numbering / tx / externalOutcomeDefaults も key phase を返す", () => {
    for (const cat of ["scope", "tax", "auth", "db", "numbering", "tx", "externalOutcomeDefaults"]) {
      const v = `@conv.${cat}.`;
      const r = computeCompletion(v, v.length, catalog);
      expect(r.phase).toBe("key");
    }
  });
});

describe("insertCandidate", () => {
  it("category phase: prefix を置換し末尾に '.' を追加", () => {
    const v = "@conv.curre";
    const state = computeCompletion(v, v.length, catalog);
    const { newValue, newCursor } = insertCandidate(v, v.length, state, "currency");
    expect(newValue).toBe("@conv.currency.");
    expect(newCursor).toBe(newValue.length);
  });

  it("key phase: prefix を置換 (末尾に '.' なし)", () => {
    const v = "@conv.currency.j";
    const state = computeCompletion(v, v.length, catalog);
    const { newValue, newCursor } = insertCandidate(v, v.length, state, "jpy");
    expect(newValue).toBe("@conv.currency.jpy");
    expect(newCursor).toBe(newValue.length);
  });

  it("カーソルが文中: カーソル以降を保持", () => {
    const v = "@conv.curre xxx";
    const cursor = "@conv.curre".length;
    const state = computeCompletion(v, cursor, catalog);
    const { newValue, newCursor } = insertCandidate(v, cursor, state, "currency");
    expect(newValue).toBe("@conv.currency. xxx");
    expect(newCursor).toBe("@conv.currency.".length);
  });

  it("idle state → 変更なし", () => {
    const v = "hello";
    const { newValue, newCursor } = insertCandidate(v, 5, { phase: "idle" }, "anything");
    expect(newValue).toBe("hello");
    expect(newCursor).toBe(5);
  });
});
