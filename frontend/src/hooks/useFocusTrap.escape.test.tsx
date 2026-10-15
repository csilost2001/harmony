import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { useFocusTrap } from "./useFocusTrap";

function Dialog({ onEscape, label }: { onEscape?: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onEscape);
  return <div ref={ref} role="dialog" aria-modal="true" aria-label={label}><button>{label}</button></div>;
}

describe("useFocusTrap — Esc で閉じる", () => {
  it("onEscape を渡すと、Esc で呼ばれる。渡さなければ何も起きない", () => {
    const onEscape = vi.fn();
    const { unmount } = render(<Dialog onEscape={onEscape} label="a" />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
    unmount();
    render(<Dialog label="b" />);
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("日本語の変換中の Esc では呼ばない", () => {
    const onEscape = vi.fn();
    render(<Dialog onEscape={onEscape} label="a" />);
    fireEvent.keyDown(document, { key: "Escape", isComposing: true });
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("ダイアログが重なっているときは、いちばん上のものだけが閉じる", () => {
    const outer = vi.fn(); const inner = vi.fn();
    render(<div><Dialog onEscape={outer} label="outer" /><Dialog onEscape={inner} label="inner" /></div>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("ダイアログが重なっているとき、Tab は、いちばん上のダイアログの中だけで循環する (下のものが奪わない)", () => {
    const { getAllByRole } = render(
      <div>
        <Dialog onEscape={() => undefined} label="outer" />
        <Dialog onEscape={() => undefined} label="inner" />
      </div>,
    );
    const [, innerBtn] = getAllByRole("button");
    innerBtn.focus();
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    // 上のダイアログの中の 1 つだけのボタン: 自分に戻る (下のダイアログに奪われない)
    expect(document.activeElement).toBe(innerBtn);
  });
});
