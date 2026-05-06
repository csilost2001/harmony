import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useListSort } from "./useListSort";

interface Item {
  id: string;
  name: string;
  age: number;
}

const items: Item[] = [
  { id: "a", name: "Bob", age: 30 },
  { id: "b", name: "Alice", age: 25 },
  { id: "c", name: "Alice", age: 28 },
  { id: "d", name: "Carol", age: 22 },
];

const accessor = (it: Item, key: string) =>
  key === "name" ? it.name : key === "age" ? it.age : "";

function setup() {
  return renderHook(() => useListSort(items, accessor));
}

describe("useListSort", () => {
  it("初期状態はソートなしで items と同じ順序", () => {
    const { result } = setup();
    expect(result.current.sortKeys).toEqual([]);
    expect(result.current.sorted.map((it) => it.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("toggleSort で昇順ソートされる", () => {
    const { result } = setup();
    act(() => result.current.toggleSort("name"));
    expect(result.current.sortKeys).toEqual([{ columnKey: "name", direction: "asc" }]);
    expect(result.current.sorted.map((it) => it.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("同じ列を再度 toggleSort すると降順になる", () => {
    const { result } = setup();
    act(() => result.current.toggleSort("name"));
    act(() => result.current.toggleSort("name"));
    expect(result.current.sortKeys).toEqual([{ columnKey: "name", direction: "desc" }]);
    expect(result.current.sorted.map((it) => it.id)).toEqual(["d", "a", "b", "c"]);
  });

  it("3 回目の toggleSort で解除される", () => {
    const { result } = setup();
    act(() => result.current.toggleSort("name"));
    act(() => result.current.toggleSort("name"));
    act(() => result.current.toggleSort("name"));
    expect(result.current.sortKeys).toEqual([]);
    expect(result.current.sorted.map((it) => it.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("addKey=true で多段ソートに追加できる", () => {
    const { result } = setup();
    act(() => result.current.toggleSort("name"));
    act(() => result.current.toggleSort("age", { addKey: true }));
    expect(result.current.sortKeys).toEqual([
      { columnKey: "name", direction: "asc" },
      { columnKey: "age", direction: "asc" },
    ]);
    // name 昇順 → 同名内で age 昇順: Alice25, Alice28, Bob30, Carol22
    expect(result.current.sorted.map((it) => it.id)).toEqual(["b", "c", "a", "d"]);
  });

  it("多段ソート中に通常クリックすると単一ソートに縮約", () => {
    const { result } = setup();
    act(() => result.current.toggleSort("name"));
    act(() => result.current.toggleSort("age", { addKey: true }));
    act(() => result.current.toggleSort("age"));
    expect(result.current.sortKeys).toEqual([{ columnKey: "age", direction: "asc" }]);
  });

  it("getSortRank は単一ソートでは null", () => {
    const { result } = setup();
    act(() => result.current.toggleSort("name"));
    expect(result.current.getSortRank("name")).toBeNull();
  });

  it("getSortRank は多段ソート時に 1-indexed", () => {
    const { result } = setup();
    act(() => result.current.toggleSort("name"));
    act(() => result.current.toggleSort("age", { addKey: true }));
    expect(result.current.getSortRank("name")).toBe(1);
    expect(result.current.getSortRank("age")).toBe(2);
    expect(result.current.getSortRank("other")).toBeNull();
  });

  it("getSortDirection でソート方向を取得", () => {
    const { result } = setup();
    act(() => result.current.toggleSort("name"));
    act(() => result.current.toggleSort("name"));
    expect(result.current.getSortDirection("name")).toBe("desc");
    expect(result.current.getSortDirection("age")).toBeNull();
  });

  it("clearSort で全解除", () => {
    const { result } = setup();
    act(() => result.current.toggleSort("name"));
    act(() => result.current.toggleSort("age", { addKey: true }));
    act(() => result.current.clearSort());
    expect(result.current.sortKeys).toEqual([]);
  });
});
