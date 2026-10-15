import { describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useStepKeyboard, type StepKeyboardHandlers } from "./useStepKeyboard";

function Harness({ h }: { h: StepKeyboardHandlers }) {
  useStepKeyboard(h);
  return (
    <div className="process-flow-page">
      <div className="step-card-wrapper">
        <div className="step-card" data-step-id="a">
          <div className="step-card-header" tabIndex={0} data-expanded={false} data-testid="ha" />
        </div>
      </div>
      <div className="step-card-wrapper">
        <div className="step-card" data-step-id="b">
          <div className="step-card-header" tabIndex={0} data-expanded data-testid="hb" />
          <div className="step-card-body">
            <textarea data-testid="fb" />
          </div>
        </div>
        <div className="sub-steps">
          <div className="mb-1">
            <div className="step-card-wrapper">
              <div className="step-card" data-step-id="b1">
                <div className="step-card-header" tabIndex={0} data-expanded={false} data-testid="hb1" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const mk = (over: Partial<StepKeyboardHandlers> = {}): StepKeyboardHandlers => ({
  editing: true, onInsert: vi.fn(), onIndent: vi.fn(() => true), onOutdent: vi.fn(() => true), onFocusStep: vi.fn(), ...over,
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
    expect(h.onFocusStep).toHaveBeenLastCalledWith("b1", false, false);
    key(getByTestId("hb1"), "Home");
    expect(document.activeElement).toBe(getByTestId("ha"));
    expect(h.onFocusStep).toHaveBeenLastCalledWith("a", true, false);
  });

  it("Shift+↑↓ で、選択を広げる (最上位の工程どうしのとき)。ふつうの移動では広げない", () => {
    const onExtendSelection = vi.fn();
    const h = mk({ onExtendSelection });
    const { getByTestId } = render(<Harness h={h} />);
    getByTestId("ha").focus();
    key(getByTestId("ha"), "ArrowDown", { shiftKey: true });
    expect(onExtendSelection).toHaveBeenLastCalledWith("a", "b");
    expect(h.onFocusStep).toHaveBeenLastCalledWith("b", true, true);
    // 入れ子の工程へ移るときは、広げない
    key(getByTestId("hb"), "ArrowDown", { shiftKey: true });
    expect(onExtendSelection).toHaveBeenCalledTimes(1);
    key(getByTestId("hb1"), "Home");
    expect(onExtendSelection).toHaveBeenCalledTimes(1);
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

  it("Tab でインデント / Shift+Tab でアウトデント。できたときだけ通常の Tab を止める", () => {
    const h = mk();
    const { getByTestId } = render(<Harness h={h} />);
    key(getByTestId("hb"), "Tab");
    expect(h.onIndent).toHaveBeenCalledWith("b");
    key(getByTestId("hb1"), "Tab", { shiftKey: true });
    expect(h.onOutdent).toHaveBeenCalledWith("b1");
    // できなかった (false) ときは、通常のフォーカス移動のまま
    const no = mk({ onIndent: vi.fn(() => false), onOutdent: vi.fn(() => false) });
    cleanup();
    const r = render(<Harness h={no} />);
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    r.getByTestId("ha").dispatchEvent(ev);
    expect(no.onIndent).toHaveBeenCalledWith("a");
    expect(ev.defaultPrevented).toBe(false);
  });

  it("処理を渡さなければ Tab は何もしない (通常のフォーカス移動)", () => {
    const h = mk({ onIndent: undefined, onOutdent: undefined });
    const { getByTestId } = render(<Harness h={h} />);
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    getByTestId("hb").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
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
