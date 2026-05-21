import { describe, it, expect } from "vitest";
import { computeReferenceCompletion, insertReferenceCandidate } from "./completer";
import { convResolver } from "./convResolver";
import type { Candidate, CompletionContext } from "./types";
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";

const catalog: ConventionsCatalog = {
  version: "1.0.0",
  msg: { required: { template: "{label}は必須入力です" } },
  regex: {},
  limit: {},
  scope: {},
  currency: { jpy: { code: "JPY" } },
  tax: {},
  auth: {},
  db: {},
  numbering: {},
  tx: {},
  externalOutcomeDefaults: {},
};

const ctx = (conventions: ConventionsCatalog | null = catalog): CompletionContext => ({
  conventions,
});

describe("computeReferenceCompletion", () => {
  it("resolver なし → idle", () => {
    const s = computeReferenceCompletion("@conv.", 6, [], ctx());
    expect(s.phase).toBe("idle");
  });

  it("convResolver でマッチ → active", () => {
    const v = "@conv.";
    const s = computeReferenceCompletion(v, v.length, [convResolver], ctx());
    expect(s.phase).toBe("active");
  });

  it("マッチしない入力 → idle", () => {
    const s = computeReferenceCompletion("hello world", 11, [convResolver], ctx());
    expect(s.phase).toBe("idle");
  });

  it("conventions null → idle", () => {
    const v = "@conv.";
    const s = computeReferenceCompletion(v, v.length, [convResolver], ctx(null));
    expect(s.phase).toBe("idle");
  });
});

describe("insertReferenceCandidate", () => {
  it("idle state → 変更なし", () => {
    const candidate: Candidate = { value: "anything" };
    const result = insertReferenceCandidate("hello", 5, { phase: "idle" }, candidate);
    expect(result.newValue).toBe("hello");
    expect(result.newCursor).toBe(5);
  });

  it("active state: prefix を置換し trailing を付与", () => {
    const v = "@conv.curre";
    const state = computeReferenceCompletion(v, v.length, [convResolver], ctx());
    expect(state.phase).toBe("active");
    const candidate: Candidate = { value: "currency", trailing: "." };
    const { newValue, newCursor } = insertReferenceCandidate(v, v.length, state, candidate);
    expect(newValue).toBe("@conv.currency.");
    expect(newCursor).toBe(newValue.length);
  });

  it("active state: key 補完 (trailing なし)", () => {
    const v = "@conv.currency.j";
    const state = computeReferenceCompletion(v, v.length, [convResolver], ctx());
    expect(state.phase).toBe("active");
    const candidate: Candidate = { value: "jpy" };
    const { newValue, newCursor } = insertReferenceCandidate(v, v.length, state, candidate);
    expect(newValue).toBe("@conv.currency.jpy");
    expect(newCursor).toBe(newValue.length);
  });

  it("カーソルが文中: カーソル以降を保持", () => {
    const v = "@conv.curre xxx";
    const cursor = "@conv.curre".length;
    const state = computeReferenceCompletion(v, cursor, [convResolver], ctx());
    expect(state.phase).toBe("active");
    const candidate: Candidate = { value: "currency", trailing: "." };
    const { newValue, newCursor } = insertReferenceCandidate(v, cursor, state, candidate);
    expect(newValue).toBe("@conv.currency. xxx");
    expect(newCursor).toBe("@conv.currency.".length);
  });
});
