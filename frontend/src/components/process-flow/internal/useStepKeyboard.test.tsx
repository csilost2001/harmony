import { describe, it, expect, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useStepKeyboard, type StepKeyboardHandlers } from "./useStepKeyboard";

function Harness({ h }: { h: StepKeyboardHandlers }) {
  useStepKeyboard(h);
  return (
    <div className="process-flow-page">
      <div className="step-card-wrapper">
        <div className="step-card" data-step-id="a">
          <div className="step-card-header" tabIndex={0} aria-expanded={false} data-testid="ha" />
        </div>
      </div>
      <div className="step-card-wrapper">
        <div className="step-card" data-step-id="b">
          <div className="step-card-header" tabIndex={0} aria-expanded data-testid="hb" />
          <div className="step-card-body">
            <textarea data-testid="fb" />
          </div>
        </div>
        <div className="sub-steps">
          <div className="mb-1">
            <div className="step-card-wrapper">
              <div className="step-card" data-step-id="b1">
                <div className="step-card-header" tabIndex={0} aria-expanded={false} data-testid="hb1" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const mk = (over: Partial<StepKeyboardHandlers> = {}): StepKeyboardHandlers => ({
  editing: true, onInsert: vi.fn(), onIndent: vi.fn(), onOutdent: vi.fn(), onFocusStep: vi.fn(), ...over,
});
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(el, { key: k, ...init });

describe("useStepKeyboard", () => {
  it("↑↓ で前後の見出しへ (入れ子も画面の順)。移ったら選択を知らせる", () => {
    const h = mk();
    const { getByTestId } = render(<Harness h={h} />);
    getByTestId("ha").focus();
    key(getByTestId("ha"), "ArrowDown");
    expect(document.activeElement).toBe(getByTestId("hb"));
    key(getByTestId("hb"), "ArrowDown");
    expect(document.activeElement).toBe(getByTestId("hb1"));
    expect(h.onFocusStep).toHaveBeenLastCalledWith("b1", false);
    key(getByTestId("hb1"), "Home");
    expect(document.activeElement).toBe(getByTestId("ha"));
    expect(h.onFocusStep).toHaveBeenLastCalledWith("a", true);
  });

  it("Insert と / で挿入メニュー、入力欄の中の Ctrl+Enter でも。閲覧中は開かない。どこでも Insert は末尾", () => {
    const h = mk();
    const { getByTestId } = render(<Harness h={h} />);
    key(getByTestId("hb"), "Insert");
    expect(h.onInsert).toHaveBeenLastCalledWith("b");
    key(getByTestId("ha"), "/");
    expect(h.onInsert).toHaveBeenLastCalledWith("a");
    key(getByTestId("fb"), "Enter", { ctrlKey: true });
    expect(h.onInsert).toHaveBeenLastCalledWith("b");
    key(document.querySelector(".process-flow-page")!, "Insert");
    expect(h.onInsert).toHaveBeenLastCalledWith(null);

    const ro = mk({ editing: false });
    const r2 = render(<Harness h={ro} />);
    key(r2.getAllByTestId("ha")[1], "Insert");
    expect(ro.onInsert).not.toHaveBeenCalled();
  });

  it("Tab でインデント (最上位) / Shift+Tab でアウトデント (入れ子)。その逆は何もしない", () => {
    const h = mk();
    const { getByTestId } = render(<Harness h={h} />);
    key(getByTestId("hb"), "Tab");
    expect(h.onIndent).toHaveBeenCalledWith("b");
    key(getByTestId("hb1"), "Tab", { shiftKey: true });
    expect(h.onOutdent).toHaveBeenCalledWith("b", "b1");
    key(getByTestId("hb"), "Tab", { shiftKey: true });
    key(getByTestId("hb1"), "Tab");
    expect(h.onIndent).toHaveBeenCalledTimes(1);
    expect(h.onOutdent).toHaveBeenCalledTimes(1);
  });

  it("Esc で、入力欄から工程の見出しへ戻る。→ ← で開閉 (見出しの click)", () => {
    const h = mk();
    const { getByTestId } = render(<Harness h={h} />);
    getByTestId("fb").focus();
    key(getByTestId("fb"), "Escape");
    expect(document.activeElement).toBe(getByTestId("hb"));
    const click = vi.fn(); getByTestId("ha").addEventListener("click", click);
    key(getByTestId("ha"), "ArrowRight");
    expect(click).toHaveBeenCalledTimes(1);
    key(getByTestId("ha"), "ArrowLeft"); // 閉じているので何もしない
    expect(click).toHaveBeenCalledTimes(1);
  });
});
