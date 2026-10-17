import { describe, it, expect } from "vitest";
import { hasUnsavedChanges, hasUnsavedOwnSession } from "./editSessionHints";

const mine = "me";
const base = { state: "Active", participants: { [mine]: {} } };

describe("hasUnsavedChanges", () => {
  it("保存の記録が無く、変更があれば、未保存", () => {
    expect(hasUnsavedChanges({ sequence: 3, saveHistory: [] })).toBe(true);
  });
  it("変更が無い (番号 0) なら、未保存ではない", () => {
    expect(hasUnsavedChanges({ sequence: 0, saveHistory: [] })).toBe(false);
  });
  it("最後の保存と同じ番号なら、保存済み。保存のあとに変更があれば、未保存", () => {
    expect(hasUnsavedChanges({ sequence: 4, saveHistory: [{ sequence: 2 }, { sequence: 4 }] })).toBe(false);
    expect(hasUnsavedChanges({ sequence: 5, saveHistory: [{ sequence: 2 }, { sequence: 4 }] })).toBe(true);
  });
  it("番号が分からなければ、未保存とみなす (従来どおり確認を出す)", () => {
    expect(hasUnsavedChanges({})).toBe(true);
  });
});

describe("hasUnsavedOwnSession (ISSUE #1528)", () => {
  it("自分の Active なセッションに未保存の変更があれば true", () => {
    expect(hasUnsavedOwnSession([{ ...base, sequence: 2, saveHistory: [] }], mine)).toBe(true);
  });
  it("保存したまま残っている自分のセッションは、続きではないので false", () => {
    expect(hasUnsavedOwnSession([{ ...base, sequence: 2, saveHistory: [{ sequence: 2 }] }], mine)).toBe(false);
  });
  it("他の人のセッション・Discarded のセッションは対象外", () => {
    expect(hasUnsavedOwnSession([{ state: "Active", participants: { other: {} }, sequence: 2, saveHistory: [] }], mine)).toBe(false);
    expect(hasUnsavedOwnSession([{ ...base, state: "Discarded", sequence: 2, saveHistory: [] }], mine)).toBe(false);
  });
});
