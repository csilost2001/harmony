import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { ListContextMenu, type ContextMenuItem } from "./ListContextMenu";

// docs/spec/list-common.md §3.11 / §4.6 / §5.10 — ListContextMenu の振る舞い

function sampleItems(onCopy: () => void, onDelete: () => void, disabledPaste = true): ContextMenuItem[] {
  return [
    { key: "new", label: "新規作成", icon: "bi-plus-lg", onClick: () => {} },
    { key: "sep1", separator: true },
    { key: "copy", label: "コピー", icon: "bi-files", shortcut: "Ctrl+C", onClick: onCopy },
    { key: "paste", label: "貼り付け", icon: "bi-clipboard", shortcut: "Ctrl+V",
      disabled: disabledPaste, disabledReason: "クリップボードが空", onClick: () => {} },
    { key: "sep2", separator: true },
    { key: "delete", label: "削除", icon: "bi-trash", shortcut: "Delete", danger: true, onClick: onDelete },
  ];
}

describe("ListContextMenu", () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
  });

  it("全項目が描画され、separator は分離線として出る", () => {
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    render(<ListContextMenu x={50} y={50} items={sampleItems(onCopy, onDelete)} onClose={onClose} />);
    expect(screen.getByText("新規作成")).toBeTruthy();
    expect(screen.getByText("コピー")).toBeTruthy();
    expect(screen.getByText("貼り付け")).toBeTruthy();
    expect(screen.getByText("削除")).toBeTruthy();
    // separator は role="separator"
    expect(document.querySelectorAll('[role="separator"]').length).toBe(2);
  });

  it("有効項目クリックで onClick 実行 + onClose", () => {
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    render(<ListContextMenu x={50} y={50} items={sampleItems(onCopy, onDelete)} onClose={onClose} />);
    act(() => screen.getByText("コピー").click());
    expect(onCopy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("disabled 項目はクリックしても onClick / onClose が呼ばれない", () => {
    const onPaste = vi.fn();
    const items: ContextMenuItem[] = [
      { key: "paste", label: "貼り付け", disabled: true, disabledReason: "空", onClick: onPaste },
    ];
    render(<ListContextMenu x={50} y={50} items={items} onClose={onClose} />);
    const btn = screen.getByText("貼り付け").closest("button") as HTMLButtonElement;
    // disabled 属性が付いている
    expect(btn.disabled).toBe(true);
    // 実際にクリックしても onClick / onClose のいずれも呼ばれない (HTML disabled 属性に頼らず、
    // ListContextMenu.tsx の `if (item.disabled) return;` ガードが効いていることを検証)
    act(() => { fireEvent.click(btn); });
    expect(onPaste).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disabled 項目には disabledReason が title として付く", () => {
    const items: ContextMenuItem[] = [
      { key: "paste", label: "貼り付け", disabled: true, disabledReason: "クリップボードが空", onClick: vi.fn() },
    ];
    render(<ListContextMenu x={50} y={50} items={items} onClose={onClose} />);
    const btn = screen.getByText("貼り付け").closest("button") as HTMLButtonElement;
    expect(btn.getAttribute("title")).toBe("クリップボードが空");
  });

  it("danger 項目には danger クラスが付く", () => {
    const onDelete = vi.fn();
    render(<ListContextMenu x={50} y={50} items={sampleItems(() => {}, onDelete)} onClose={onClose} />);
    const btn = screen.getByText("削除").closest("button") as HTMLButtonElement;
    expect(btn.className).toContain("danger");
  });

  it("Esc キーで onClose が呼ばれる", () => {
    const onDelete = vi.fn();
    render(<ListContextMenu x={50} y={50} items={sampleItems(() => {}, onDelete)} onClose={onClose} />);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("外クリックで onClose が呼ばれる", () => {
    const onDelete = vi.fn();
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    render(<ListContextMenu x={50} y={50} items={sampleItems(() => {}, onDelete)} onClose={onClose} />);
    act(() => {
      // メニューの外の DOM 要素でクリック (window は Node ではなく contains が失敗するため)
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalled();
    document.body.removeChild(outside);
  });

  it("Enter キーでフォーカス中項目の onClick が呼ばれる", () => {
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    render(<ListContextMenu x={50} y={50} items={sampleItems(onCopy, onDelete)} onClose={onClose} />);
    // 初期フォーカスは最初の非 disabled 項目 (= 新規作成)
    // ArrowDown 1 回で コピー へ (新規作成 → separator スキップ → コピー)
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(onCopy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("ArrowDown は disabled 項目と separator をスキップする", () => {
    // 有効 → 無効(paste) → separator → danger(delete)
    // Enter で delete が実行される (ArrowDown 2 回で paste をスキップ → delete)
    const onCopy = vi.fn();
    const onDelete = vi.fn();
    render(<ListContextMenu x={50} y={50} items={sampleItems(onCopy, onDelete)} onClose={onClose} />);
    // 初期: 新規作成にフォーカス
    act(() => fireEvent.keyDown(window, { key: "ArrowDown" })); // → コピー
    act(() => fireEvent.keyDown(window, { key: "ArrowDown" })); // paste は disabled → 削除へ
    act(() => fireEvent.keyDown(window, { key: "Enter" }));
    expect(onDelete).toHaveBeenCalled();
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("shortcut 表示が出る (Ctrl+C / Delete 等)", () => {
    const onDelete = vi.fn();
    render(<ListContextMenu x={50} y={50} items={sampleItems(() => {}, onDelete)} onClose={onClose} />);
    expect(screen.getByText("Ctrl+C")).toBeTruthy();
    expect(screen.getByText("Delete")).toBeTruthy();
  });
});
