import { describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import { fireEvent, render } from "@testing-library/react";
import { useDetailPanelKeyboard } from "./useDetailPanelKeyboard";

function Panel({ rowId, onNext, onPrev }: { rowId: string | null; onNext?: () => void; onPrev?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onKeyDown } = useDetailPanelKeyboard({ panelRef: ref, resetKey: rowId, onNext, onPrev });
  return (
    <div ref={ref} onKeyDown={onKeyDown}>
      <input data-testid="a" defaultValue="x" />
      <input data-testid="b" />
      <input type="checkbox" data-testid="c" />
    </div>
  );
}

describe("useDetailPanelKeyboard", () => {
  it("行が切り替わったら最初の入力欄へカーソルが入る", () => {
    const { getByTestId, rerender } = render(<Panel rowId="r1" />);
    expect(document.activeElement).toBe(getByTestId("a"));
    getByTestId("b").focus();
    rerender(<Panel rowId="r2" />);
    expect(document.activeElement).toBe(getByTestId("a"));
  });

  it("Enter で次の欄へ、最後の欄では onNext", () => {
    const onNext = vi.fn();
    const { getByTestId } = render(<Panel rowId="r1" onNext={onNext} />);
    fireEvent.keyDown(getByTestId("a"), { key: "Enter" });
    expect(document.activeElement).toBe(getByTestId("b"));
    fireEvent.keyDown(getByTestId("b"), { key: "Enter" });
    expect(document.activeElement).toBe(getByTestId("c"));
    expect(onNext).not.toHaveBeenCalled();
    fireEvent.keyDown(getByTestId("c"), { key: "Enter" });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("Ctrl+Enter で次の行、Ctrl+Shift+Enter で前の行", () => {
    const onNext = vi.fn(); const onPrev = vi.fn();
    const { getByTestId } = render(<Panel rowId="r1" onNext={onNext} onPrev={onPrev} />);
    fireEvent.keyDown(getByTestId("a"), { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(getByTestId("a"), { key: "Enter", ctrlKey: true, shiftKey: true });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("変換の確定の Enter は無視する", () => {
    const { getByTestId } = render(<Panel rowId="r1" />);
    fireEvent.keyDown(getByTestId("a"), { key: "Enter", isComposing: true });
    expect(document.activeElement).toBe(getByTestId("a"));
  });

  it("Esc で入力欄から出る", () => {
    const { getByTestId } = render(<Panel rowId="r1" />);
    fireEvent.keyDown(getByTestId("a"), { key: "Escape" });
    expect(document.activeElement).toBe(document.body);
  });

  it("部品が処理済み (preventDefault) の Enter / Esc や、候補が開いている欄では何もしない", () => {
    const onNext = vi.fn();
    const { getByTestId } = render(<Panel rowId="r1" onNext={onNext} />);
    const a = getByTestId("a");
    a.addEventListener("keydown", (ev) => ev.preventDefault()); // 部品が先に処理した
    fireEvent.keyDown(a, { key: "Enter" });
    expect(document.activeElement).toBe(a);
    a.setAttribute("aria-expanded", "true"); // 候補が開いている
    const b = getByTestId("b");
    b.setAttribute("aria-expanded", "true");
    b.focus();
    fireEvent.keyDown(b, { key: "Enter" });
    fireEvent.keyDown(b, { key: "Escape" });
    expect(document.activeElement).toBe(b);
    expect(onNext).not.toHaveBeenCalled();
  });
});
