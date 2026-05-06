import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useListSelection } from "./useListSelection";

interface Item {
  id: string;
  name: string;
}

const items: Item[] = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
  { id: "c", name: "C" },
  { id: "d", name: "D" },
];

function setup() {
  return renderHook(() => useListSelection(items, (it) => it.id));
}

describe("useListSelection", () => {
  it("初期状態は空選択", () => {
    const { result } = setup();
    expect(result.current.selectedIds.size).toBe(0);
    expect(result.current.selectedItems).toEqual([]);
  });

  it("通常クリックで単一選択になる", () => {
    const { result } = setup();
    act(() => result.current.handleRowClick("b", {}));
    expect(result.current.selectedIds).toEqual(new Set(["b"]));
    expect(result.current.selectedItems).toEqual([{ id: "b", name: "B" }]);
  });

  it("別の行を通常クリックすると単一選択が切り替わる", () => {
    const { result } = setup();
    act(() => result.current.handleRowClick("a", {}));
    act(() => result.current.handleRowClick("c", {}));
    expect(result.current.selectedIds).toEqual(new Set(["c"]));
  });

  it("Ctrl+クリックで追加選択できる", () => {
    const { result } = setup();
    act(() => result.current.handleRowClick("a", {}));
    act(() => result.current.handleRowClick("c", { ctrlKey: true }));
    expect(result.current.selectedIds).toEqual(new Set(["a", "c"]));
  });

  it("Ctrl+クリックで選択済み行は選択解除される (トグル)", () => {
    const { result } = setup();
    act(() => result.current.handleRowClick("a", {}));
    act(() => result.current.handleRowClick("b", { ctrlKey: true }));
    act(() => result.current.handleRowClick("a", { ctrlKey: true }));
    expect(result.current.selectedIds).toEqual(new Set(["b"]));
  });

  it("metaKey も Ctrl と同等に扱われる (Mac 向け)", () => {
    const { result } = setup();
    act(() => result.current.handleRowClick("a", {}));
    act(() => result.current.handleRowClick("c", { metaKey: true }));
    expect(result.current.selectedIds).toEqual(new Set(["a", "c"]));
  });

  it("Shift+クリックでアンカーから範囲選択できる", () => {
    const { result } = setup();
    act(() => result.current.handleRowClick("a", {}));
    act(() => result.current.handleRowClick("c", { shiftKey: true }));
    expect(result.current.selectedIds).toEqual(new Set(["a", "b", "c"]));
  });

  it("Shift+クリックは逆順 (下→上) でも範囲選択できる", () => {
    const { result } = setup();
    act(() => result.current.handleRowClick("d", {}));
    act(() => result.current.handleRowClick("b", { shiftKey: true }));
    expect(result.current.selectedIds).toEqual(new Set(["b", "c", "d"]));
  });

  it("selectAll で全選択になる", () => {
    const { result } = setup();
    act(() => result.current.selectAll());
    expect(result.current.selectedIds).toEqual(new Set(["a", "b", "c", "d"]));
  });

  it("clearSelection で選択解除される", () => {
    const { result } = setup();
    act(() => result.current.selectAll());
    act(() => result.current.clearSelection());
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("isSelected で特定 ID の選択状態を取得できる", () => {
    const { result } = setup();
    act(() => result.current.handleRowClick("b", {}));
    expect(result.current.isSelected("b")).toBe(true);
    expect(result.current.isSelected("a")).toBe(false);
  });

  it("setSelectedIds で外部から選択状態を上書きできる", () => {
    const { result } = setup();
    act(() => result.current.setSelectedIds(new Set(["a", "d"])));
    expect(result.current.selectedIds).toEqual(new Set(["a", "d"]));
  });
});
