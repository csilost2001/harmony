import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useListFilter } from "./useListFilter";

interface Item {
  id: string;
  kind: "screen" | "table" | "action";
}

const items: Item[] = [
  { id: "a", kind: "screen" },
  { id: "b", kind: "table" },
  { id: "c", kind: "screen" },
  { id: "d", kind: "action" },
];

describe("useListFilter", () => {
  it("初期状態はフィルタ無効で items と同じ", () => {
    const { result } = renderHook(() => useListFilter(items));
    expect(result.current.isActive).toBe(false);
    expect(result.current.filtered).toEqual(items);
    expect(result.current.totalCount).toBe(4);
    expect(result.current.visibleCount).toBe(4);
  });

  it("applyFilter で述語を適用できる", () => {
    const { result } = renderHook(() => useListFilter(items));
    act(() => result.current.applyFilter((it) => it.kind === "screen"));
    expect(result.current.isActive).toBe(true);
    expect(result.current.filtered.map((it) => it.id)).toEqual(["a", "c"]);
    expect(result.current.visibleCount).toBe(2);
    expect(result.current.totalCount).toBe(4);
  });

  it("clearFilter で無効化される", () => {
    const { result } = renderHook(() => useListFilter(items));
    act(() => result.current.applyFilter((it) => it.kind === "table"));
    act(() => result.current.clearFilter());
    expect(result.current.isActive).toBe(false);
    expect(result.current.filtered).toEqual(items);
  });

  it("applyFilter(null) でも無効化できる", () => {
    const { result } = renderHook(() => useListFilter(items));
    act(() => result.current.applyFilter((it) => it.kind === "table"));
    act(() => result.current.applyFilter(null));
    expect(result.current.isActive).toBe(false);
  });
});
