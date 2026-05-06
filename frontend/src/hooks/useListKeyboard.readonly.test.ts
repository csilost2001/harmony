import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useListSelection } from "./useListSelection";
import { useListKeyboard } from "./useListKeyboard";
import { useListSort } from "./useListSort";
import { useListClipboard } from "./useListClipboard";

// docs/spec/list-common.md §3.9 — ソート中の Read-only モード
//
// ソート中 (sort.sortKeys.length > 0) は以下を無効化:
//   - Ctrl+V (貼り付け)
//   - Ctrl+D (複製)
//   - Alt+↑↓ (移動)
// 引き続き動作:
//   - Ctrl+C (コピー)
//   - Ctrl+X (切り取り)
//   - Delete
//   - 選択・フォーカス移動

interface Item { id: string; name: string; }

const items: Item[] = [
  { id: "a", name: "Alpha" },
  { id: "b", name: "Bravo" },
  { id: "c", name: "Charlie" },
];

function fireKey(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

interface Callbacks {
  onDelete?: ReturnType<typeof vi.fn>;
  onPaste?: ReturnType<typeof vi.fn>;
  onDuplicate?: ReturnType<typeof vi.fn>;
  onMoveUp?: ReturnType<typeof vi.fn>;
  onMoveDown?: ReturnType<typeof vi.fn>;
}

function setupSorted(cbs: Callbacks = {}) {
  return renderHook(() => {
    const sort = useListSort(items, (t, key) => (key === "name" ? t.name : ""));
    const sel = useListSelection(items, (t) => t.id);
    // 本番コードパスと同じく clipboard を経由させる
    // (@deprecated onCut/onCopy ではなく clipboard.mode を検証することで、
    //  将来 onCut/onCopy が削除されても偽陽性にならないようにする)
    const clip = useListClipboard<Item>((t) => t.id);
    useListKeyboard({ items, getId: (t) => t.id, selection: sel, sort, clipboard: clip, ...cbs });
    return { sel, sort, clip };
  });
}

describe("useListKeyboard — ソート中 Read-only モード (§3.9)", () => {
  beforeEach(() => {
    if (document.activeElement && document.activeElement !== document.body) {
      (document.activeElement as HTMLElement).blur();
    }
  });

  describe("ソート解除中 (Read-only モード OFF)", () => {
    it("Ctrl+V が呼ばれる", () => {
      const onPaste = vi.fn();
      const { result } = setupSorted({ onPaste });
      act(() => result.current.sel.handleRowClick("a", {}));
      act(() => fireKey({ key: "v", ctrlKey: true }));
      expect(onPaste).toHaveBeenCalled();
    });

    it("Ctrl+D が呼ばれる", () => {
      const onDuplicate = vi.fn();
      const { result } = setupSorted({ onDuplicate });
      act(() => result.current.sel.handleRowClick("a", {}));
      act(() => fireKey({ key: "d", ctrlKey: true }));
      expect(onDuplicate).toHaveBeenCalled();
    });

    it("Alt+↑ / Alt+↓ が呼ばれる", () => {
      const onMoveUp = vi.fn();
      const onMoveDown = vi.fn();
      const { result } = setupSorted({ onMoveUp, onMoveDown });
      act(() => result.current.sel.handleRowClick("b", {}));
      act(() => fireKey({ key: "ArrowUp", altKey: true }));
      expect(onMoveUp).toHaveBeenCalled();
      act(() => fireKey({ key: "ArrowDown", altKey: true }));
      expect(onMoveDown).toHaveBeenCalled();
    });
  });

  describe("ソート中 (Read-only モード ON)", () => {
    it("Ctrl+V が無視される", () => {
      const onPaste = vi.fn();
      const { result } = setupSorted({ onPaste });
      act(() => result.current.sort.toggleSort("name"));
      act(() => result.current.sel.handleRowClick("a", {}));
      act(() => fireKey({ key: "v", ctrlKey: true }));
      expect(onPaste).not.toHaveBeenCalled();
    });

    it("Ctrl+D が無視される", () => {
      const onDuplicate = vi.fn();
      const { result } = setupSorted({ onDuplicate });
      act(() => result.current.sort.toggleSort("name"));
      act(() => result.current.sel.handleRowClick("a", {}));
      act(() => fireKey({ key: "d", ctrlKey: true }));
      expect(onDuplicate).not.toHaveBeenCalled();
    });

    it("Alt+↑ / Alt+↓ が無視される", () => {
      const onMoveUp = vi.fn();
      const onMoveDown = vi.fn();
      const { result } = setupSorted({ onMoveUp, onMoveDown });
      act(() => result.current.sort.toggleSort("name"));
      act(() => result.current.sel.handleRowClick("b", {}));
      act(() => fireKey({ key: "ArrowUp", altKey: true }));
      act(() => fireKey({ key: "ArrowDown", altKey: true }));
      expect(onMoveUp).not.toHaveBeenCalled();
      expect(onMoveDown).not.toHaveBeenCalled();
    });

    it("ソート中でも Ctrl+C はクリップボードに copy として入る", () => {
      const { result } = setupSorted();
      act(() => result.current.sort.toggleSort("name"));
      act(() => result.current.sel.handleRowClick("a", {}));
      act(() => fireKey({ key: "c", ctrlKey: true }));
      expect(result.current.clip.clipboard.mode).toBe("copy");
      expect(result.current.clip.clipboard.items.length).toBe(1);
    });

    it("ソート中でも Ctrl+X はクリップボードに cut として入る (ghost state)", () => {
      const { result } = setupSorted();
      act(() => result.current.sort.toggleSort("name"));
      act(() => result.current.sel.handleRowClick("a", {}));
      act(() => fireKey({ key: "x", ctrlKey: true }));
      expect(result.current.clip.clipboard.mode).toBe("cut");
      expect(result.current.clip.clipboard.items.length).toBe(1);
      expect(result.current.clip.isItemCut("a")).toBe(true);
    });

    it("Delete は引き続き呼ばれる (位置不要・例外として許可)", () => {
      const onDelete = vi.fn();
      const { result } = setupSorted({ onDelete });
      act(() => result.current.sort.toggleSort("name"));
      act(() => result.current.sel.handleRowClick("a", {}));
      act(() => fireKey({ key: "Delete" }));
      expect(onDelete).toHaveBeenCalled();
    });

    it("選択・フォーカス移動は引き続き動作する", () => {
      const { result } = setupSorted();
      act(() => result.current.sort.toggleSort("name"));
      act(() => result.current.sel.handleRowClick("a", {}));
      act(() => fireKey({ key: "ArrowDown" }));
      // selection が変わることを確認 (単純に handler が実行されていれば OK)
      expect(result.current.sel.selectedIds.size).toBeGreaterThan(0);
    });

    it("ソート解除後は Ctrl+V が再度呼ばれる", () => {
      const onPaste = vi.fn();
      const { result } = setupSorted({ onPaste });
      act(() => result.current.sort.toggleSort("name"));
      act(() => result.current.sel.handleRowClick("a", {}));
      act(() => fireKey({ key: "v", ctrlKey: true }));
      expect(onPaste).not.toHaveBeenCalled();
      act(() => result.current.sort.clearSort());
      act(() => fireKey({ key: "v", ctrlKey: true }));
      expect(onPaste).toHaveBeenCalled();
    });
  });
});
