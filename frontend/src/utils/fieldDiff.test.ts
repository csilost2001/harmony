import { describe, it, expect } from "vitest";
import { changedKeys, sameValue } from "./fieldDiff";

describe("sameValue", () => {
  it("空どうし (未設定・null・空文字・false) は同じ。値は、中身が同じなら同じ", () => {
    expect(sameValue(undefined, "")).toBe(true);
    expect(sameValue(false, undefined)).toBe(true);
    expect(sameValue(null, false)).toBe(true);
    expect(sameValue(0, undefined)).toBe(false); // 0 は値
    expect(sameValue("a", "a")).toBe(true);
    expect(sameValue(true, undefined)).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1 })).toBe(true);
  });
});

describe("changedKeys", () => {
  const base = { name: "金額", notNull: false, length: 10, comment: undefined as string | undefined };
  it("違う項目だけを返す", () => {
    const cur = { ...base, name: "売上金額", notNull: true };
    expect([...changedKeys(cur, base, ["name", "notNull", "length", "comment"])].sort()).toEqual(["name", "notNull"]);
  });
  it("チェックを外した (false) のと、項目が無いのは、変更ではない", () => {
    expect(changedKeys({ ...base, notNull: undefined as unknown as boolean }, base, ["notNull"]).size).toBe(0);
  });
  it("基準が無ければ (新しい行)、変更の印は付けない", () => {
    expect(changedKeys(base, undefined, ["name"]).size).toBe(0);
  });
});
