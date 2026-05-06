import { describe, it, expect } from "vitest";
import { renumber, nextNo } from "./listOrder";

// docs/spec/list-common.md §3.10 — no フィールドの連番 1..N 維持

describe("renumber", () => {
  it("空配列を受けても空配列を返す", () => {
    expect(renumber([])).toEqual([]);
  });

  it("既に 1..N 連番なら同値を返す", () => {
    const items = [
      { id: "a", no: 1 },
      { id: "b", no: 2 },
      { id: "c", no: 3 },
    ];
    expect(renumber(items)).toEqual(items);
  });

  it("順序がおかしい場合、配列順に基づいて 1..N を振り直す", () => {
    const items = [
      { id: "a", no: 3 },
      { id: "b", no: 1 },
      { id: "c", no: 2 },
    ];
    expect(renumber(items)).toEqual([
      { id: "a", no: 1 },
      { id: "b", no: 2 },
      { id: "c", no: 3 },
    ]);
  });

  it("no が欠落していても (マイグレーション) 配列順で採番される", () => {
    const items = [
      { id: "a" },
      { id: "b", no: 5 },
      { id: "c" },
    ];
    expect(renumber(items)).toEqual([
      { id: "a", no: 1 },
      { id: "b", no: 2 },
      { id: "c", no: 3 },
    ]);
  });

  it("idempotent: 複数回呼んでも結果は変わらない", () => {
    const items = [
      { id: "a", no: 3 },
      { id: "b", no: 1 },
      { id: "c", no: 2 },
    ];
    const once = renumber(items);
    const twice = renumber(once);
    expect(twice).toEqual(once);
  });

  it("他のフィールドは保持する", () => {
    const items = [
      { id: "a", no: 0, name: "Alpha" },
      { id: "b", no: 0, name: "Beta" },
    ];
    const result = renumber(items);
    expect(result[0]).toEqual({ id: "a", no: 1, name: "Alpha" });
    expect(result[1]).toEqual({ id: "b", no: 2, name: "Beta" });
  });

  it("新しい配列を返す (元の配列は変更しない)", () => {
    const items = [{ id: "a", no: 9 }];
    const result = renumber(items);
    expect(result).not.toBe(items);
    expect(items[0].no).toBe(9);
  });
});

describe("nextNo", () => {
  it("空配列は 1 を返す", () => {
    expect(nextNo([])).toBe(1);
  });

  it("最大 no + 1 を返す", () => {
    expect(nextNo([{ no: 1 }, { no: 2 }, { no: 3 }])).toBe(4);
  });

  it("隙間がある配列でも max + 1 を返す", () => {
    expect(nextNo([{ no: 1 }, { no: 5 }, { no: 3 }])).toBe(6);
  });

  it("no が欠落している要素は 0 として扱う", () => {
    expect(nextNo([{ no: 1 }, {} as { no?: number }, { no: 2 }])).toBe(3);
  });
});
