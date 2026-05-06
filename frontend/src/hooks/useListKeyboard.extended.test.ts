import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useListSelection } from "./useListSelection";
import { useListKeyboard } from "./useListKeyboard";
import { useListClipboard } from "./useListClipboard";

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

function fireKey(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
}

beforeEach(() => {
  if (document.activeElement && document.activeElement !== document.body) {
    (document.activeElement as HTMLElement).blur();
  }
});

describe("useListKeyboard - Home/End", () => {
  it("Home で先頭行が選択される", () => {
    const { result } = renderHook(() => {
      const sel = useListSelection(items, (it) => it.id);
      useListKeyboard({ items, getId: (it) => it.id, selection: sel });
      return sel;
    });
    act(() => result.current.handleRowClick("c", {}));
    act(() => fireKey({ key: "Home" }));
    expect(result.current.selectedIds).toEqual(new Set(["a"]));
  });

  it("End で末尾行が選択される", () => {
    const { result } = renderHook(() => {
      const sel = useListSelection(items, (it) => it.id);
      useListKeyboard({ items, getId: (it) => it.id, selection: sel });
      return sel;
    });
    act(() => result.current.handleRowClick("a", {}));
    act(() => fireKey({ key: "End" }));
    expect(result.current.selectedIds).toEqual(new Set(["d"]));
  });

  it("Shift+End でアンカーから末尾まで範囲選択", () => {
    const { result } = renderHook(() => {
      const sel = useListSelection(items, (it) => it.id);
      useListKeyboard({ items, getId: (it) => it.id, selection: sel });
      return sel;
    });
    act(() => result.current.handleRowClick("b", {}));
    act(() => fireKey({ key: "End", shiftKey: true }));
    expect(result.current.selectedIds).toEqual(new Set(["b", "c", "d"]));
  });
});

describe("useListKeyboard - clipboard 連動", () => {
  it("Ctrl+C で clipboard.copy が呼ばれる", () => {
    const { result } = renderHook(() => {
      const sel = useListSelection(items, (it) => it.id);
      const clip = useListClipboard<Item>((it) => it.id);
      useListKeyboard({ items, getId: (it) => it.id, selection: sel, clipboard: clip });
      return { sel, clip };
    });
    act(() => result.current.sel.handleRowClick("b", {}));
    act(() => fireKey({ key: "c", ctrlKey: true }));
    expect(result.current.clip.clipboard.mode).toBe("copy");
    expect(result.current.clip.clipboard.items).toEqual([{ id: "b", name: "B" }]);
  });

  it("Ctrl+X で clipboard.cut が呼ばれ isItemCut=true", () => {
    const { result } = renderHook(() => {
      const sel = useListSelection(items, (it) => it.id);
      const clip = useListClipboard<Item>((it) => it.id);
      useListKeyboard({ items, getId: (it) => it.id, selection: sel, clipboard: clip });
      return { sel, clip };
    });
    act(() => result.current.sel.handleRowClick("b", {}));
    act(() => fireKey({ key: "x", ctrlKey: true }));
    expect(result.current.clip.clipboard.mode).toBe("cut");
    expect(result.current.clip.isItemCut("b")).toBe(true);
  });

  it("Esc でクリップボードも選択もクリアされる", () => {
    const { result } = renderHook(() => {
      const sel = useListSelection(items, (it) => it.id);
      const clip = useListClipboard<Item>((it) => it.id);
      useListKeyboard({ items, getId: (it) => it.id, selection: sel, clipboard: clip });
      return { sel, clip };
    });
    act(() => result.current.sel.handleRowClick("b", {}));
    act(() => fireKey({ key: "x", ctrlKey: true }));
    act(() => fireKey({ key: "Escape" }));
    expect(result.current.clip.hasContent).toBe(false);
    expect(result.current.sel.selectedIds.size).toBe(0);
  });
});

describe("useListKeyboard - grid 2D ナビ", () => {
  // カード配置: 2 列 × 2 行
  // a(0,0) b(100,0)
  // c(0,80) d(100,80)
  const rects: Record<string, DOMRect> = {
    a: new DOMRect(0, 0, 90, 70),
    b: new DOMRect(100, 0, 90, 70),
    c: new DOMRect(0, 80, 90, 70),
    d: new DOMRect(100, 80, 90, 70),
  };
  const getItemRect = (id: string) => rects[id] ?? null;

  it("↓ で下の行の同じ X 位置に移動", () => {
    const { result } = renderHook(() => {
      const sel = useListSelection(items, (it) => it.id);
      useListKeyboard({ items, getId: (it) => it.id, selection: sel, layout: "grid", getItemRect });
      return sel;
    });
    act(() => result.current.handleRowClick("a", {}));
    act(() => fireKey({ key: "ArrowDown" }));
    expect(result.current.selectedIds).toEqual(new Set(["c"]));
  });

  it("↑ で上の行の同じ X 位置に移動", () => {
    const { result } = renderHook(() => {
      const sel = useListSelection(items, (it) => it.id);
      useListKeyboard({ items, getId: (it) => it.id, selection: sel, layout: "grid", getItemRect });
      return sel;
    });
    act(() => result.current.handleRowClick("d", {}));
    act(() => fireKey({ key: "ArrowUp" }));
    expect(result.current.selectedIds).toEqual(new Set(["b"]));
  });

  it("→ で次のカードに移動", () => {
    const { result } = renderHook(() => {
      const sel = useListSelection(items, (it) => it.id);
      useListKeyboard({ items, getId: (it) => it.id, selection: sel, layout: "grid", getItemRect });
      return sel;
    });
    act(() => result.current.handleRowClick("a", {}));
    act(() => fireKey({ key: "ArrowRight" }));
    expect(result.current.selectedIds).toEqual(new Set(["b"]));
  });

  it("← で前のカードに移動", () => {
    const { result } = renderHook(() => {
      const sel = useListSelection(items, (it) => it.id);
      useListKeyboard({ items, getId: (it) => it.id, selection: sel, layout: "grid", getItemRect });
      return sel;
    });
    act(() => result.current.handleRowClick("b", {}));
    act(() => fireKey({ key: "ArrowLeft" }));
    expect(result.current.selectedIds).toEqual(new Set(["a"]));
  });
});
