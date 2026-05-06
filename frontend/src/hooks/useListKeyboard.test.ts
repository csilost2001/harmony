import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useListSelection } from "./useListSelection";
import { useListKeyboard } from "./useListKeyboard";

interface Item {
  id: string;
  name: string;
}

const items: Item[] = [
  { id: "a", name: "A" },
  { id: "b", name: "B" },
  { id: "c", name: "C" },
];

function fireKey(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

interface Callbacks {
  onActivate?: ReturnType<typeof vi.fn>;
  onDelete?: ReturnType<typeof vi.fn>;
  onCopy?: ReturnType<typeof vi.fn>;
  onCut?: ReturnType<typeof vi.fn>;
  onPaste?: ReturnType<typeof vi.fn>;
  onDuplicate?: ReturnType<typeof vi.fn>;
  onMoveUp?: ReturnType<typeof vi.fn>;
  onMoveDown?: ReturnType<typeof vi.fn>;
}

function setup(cbs: Callbacks = {}) {
  return renderHook(() => {
    const sel = useListSelection(items, (it) => it.id);
    useListKeyboard({ items, getId: (it) => it.id, selection: sel, ...cbs });
    return sel;
  });
}

describe("useListKeyboard", () => {
  beforeEach(() => {
    // フォーカスをリセット (前のテストで input にフォーカスされている可能性)
    if (document.activeElement && document.activeElement !== document.body) {
      (document.activeElement as HTMLElement).blur();
    }
  });

  it("↓ キーで最初の行が選択される (未選択状態から)", () => {
    const { result } = setup();
    act(() => fireKey({ key: "ArrowDown" }));
    expect(result.current.selectedIds).toEqual(new Set(["a"]));
  });

  it("↑ キーで最後の行が選択される (未選択状態から)", () => {
    const { result } = setup();
    act(() => fireKey({ key: "ArrowUp" }));
    expect(result.current.selectedIds).toEqual(new Set(["c"]));
  });

  it("↓ キーで次の行に選択移動", () => {
    const { result } = setup();
    act(() => result.current.handleRowClick("a", {}));
    act(() => fireKey({ key: "ArrowDown" }));
    expect(result.current.selectedIds).toEqual(new Set(["b"]));
  });

  it("Shift+↓ で選択範囲を下へ拡張", () => {
    const { result } = setup();
    act(() => result.current.handleRowClick("a", {}));
    act(() => fireKey({ key: "ArrowDown", shiftKey: true }));
    expect(result.current.selectedIds).toEqual(new Set(["a", "b"]));
  });

  it("Ctrl+A で全選択", () => {
    const { result } = setup();
    act(() => fireKey({ key: "a", ctrlKey: true }));
    expect(result.current.selectedIds).toEqual(new Set(["a", "b", "c"]));
  });

  it("Escape で選択解除", () => {
    const { result } = setup();
    act(() => result.current.selectAll());
    act(() => fireKey({ key: "Escape" }));
    expect(result.current.selectedIds.size).toBe(0);
  });

  it("Delete で onDelete が選択アイテムと共に呼ばれる", () => {
    const onDelete = vi.fn();
    const { result } = setup({ onDelete });
    act(() => result.current.handleRowClick("b", {}));
    act(() => fireKey({ key: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith([{ id: "b", name: "B" }]);
  });

  it("Ctrl+C で onCopy が選択アイテムで呼ばれる", () => {
    const onCopy = vi.fn();
    const { result } = setup({ onCopy });
    act(() => result.current.handleRowClick("a", {}));
    act(() => fireKey({ key: "c", ctrlKey: true }));
    expect(onCopy).toHaveBeenCalledWith([{ id: "a", name: "A" }]);
  });

  it("Ctrl+X で onCut が呼ばれる", () => {
    const onCut = vi.fn();
    const { result } = setup({ onCut });
    act(() => result.current.handleRowClick("a", {}));
    act(() => fireKey({ key: "x", ctrlKey: true }));
    expect(onCut).toHaveBeenCalled();
  });

  it("Ctrl+V 選択なし = insertIndex null (末尾に追記を意図)", () => {
    const onPaste = vi.fn();
    setup({ onPaste });
    act(() => fireKey({ key: "v", ctrlKey: true }));
    expect(onPaste).toHaveBeenCalledWith(null);
  });

  it("Ctrl+V 選択あり = insertIndex = 最終選択インデックス+1", () => {
    const onPaste = vi.fn();
    const { result } = setup({ onPaste });
    act(() => result.current.handleRowClick("a", {}));
    act(() => result.current.handleRowClick("b", { ctrlKey: true }));
    act(() => fireKey({ key: "v", ctrlKey: true }));
    expect(onPaste).toHaveBeenCalledWith(2);
  });

  it("Ctrl+D で onDuplicate", () => {
    const onDuplicate = vi.fn();
    const { result } = setup({ onDuplicate });
    act(() => result.current.handleRowClick("a", {}));
    act(() => fireKey({ key: "d", ctrlKey: true }));
    expect(onDuplicate).toHaveBeenCalledWith([{ id: "a", name: "A" }]);
  });

  it("Enter で onActivate (単一選択時のみ)", () => {
    const onActivate = vi.fn();
    const { result } = setup({ onActivate });
    act(() => result.current.handleRowClick("b", {}));
    act(() => fireKey({ key: "Enter" }));
    expect(onActivate).toHaveBeenCalledWith({ id: "b", name: "B" });
  });

  it("Enter は複数選択時は onActivate を呼ばない", () => {
    const onActivate = vi.fn();
    const { result } = setup({ onActivate });
    act(() => result.current.selectAll());
    act(() => fireKey({ key: "Enter" }));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("F2 でも onActivate が発火する", () => {
    const onActivate = vi.fn();
    const { result } = setup({ onActivate });
    act(() => result.current.handleRowClick("a", {}));
    act(() => fireKey({ key: "F2" }));
    expect(onActivate).toHaveBeenCalledWith({ id: "a", name: "A" });
  });

  it("Alt+↑ で onMoveUp", () => {
    const onMoveUp = vi.fn();
    const { result } = setup({ onMoveUp });
    act(() => result.current.handleRowClick("b", {}));
    act(() => fireKey({ key: "ArrowUp", altKey: true }));
    expect(onMoveUp).toHaveBeenCalledWith([{ id: "b", name: "B" }]);
  });

  it("Alt+↓ で onMoveDown", () => {
    const onMoveDown = vi.fn();
    const { result } = setup({ onMoveDown });
    act(() => result.current.handleRowClick("b", {}));
    act(() => fireKey({ key: "ArrowDown", altKey: true }));
    expect(onMoveDown).toHaveBeenCalledWith([{ id: "b", name: "B" }]);
  });

  it("input フォーカス中はキーが無効", () => {
    const onDelete = vi.fn();
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    try {
      const { result } = setup({ onDelete });
      act(() => result.current.setSelectedIds(new Set(["a"])));
      const ev = new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true });
      Object.defineProperty(ev, "target", { value: input });
      act(() => window.dispatchEvent(ev));
      expect(onDelete).not.toHaveBeenCalled();
    } finally {
      input.remove();
    }
  });

  it("enabled=false なら全キー無効", () => {
    const onCopy = vi.fn();
    const { result } = renderHook(() => {
      const sel = useListSelection(items, (it) => it.id);
      useListKeyboard({ items, getId: (it) => it.id, selection: sel, onCopy, enabled: false });
      return sel;
    });
    act(() => result.current.handleRowClick("a", {}));
    act(() => fireKey({ key: "c", ctrlKey: true }));
    expect(onCopy).not.toHaveBeenCalled();
  });
});
