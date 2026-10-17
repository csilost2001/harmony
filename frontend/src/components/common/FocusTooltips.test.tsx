import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { FocusTooltips } from "./FocusTooltips";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); document.body.innerHTML = ""; });

describe("FocusTooltips (続編 第 10 弾 #196)", () => {
  it("フォーカスが当たると、title の文を出す。末尾のキーは kbd。Esc で消える。title は要素に残る", () => {
    render(<><FocusTooltips /><button title="保存 (Ctrl+S)">保存</button></>);
    const btn = screen.getByRole("button", { name: "保存" });
    fireEvent.keyDown(document.body, { key: "Tab" }); // キーボードの操作の後 (:focus-visible になる)
    act(() => { btn.focus(); });
    act(() => { vi.advanceTimersByTime(400); });
    const tip = screen.getByTestId("focus-tooltip");
    expect(tip.textContent).toContain("保存");
    expect([...tip.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(["Ctrl", "S"]);
    expect(btn.getAttribute("title")).toBe("保存 (Ctrl+S)");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("focus-tooltip")).toBeNull();
  });
  it("フォーカスが外れると消える。title の無い要素では出さない", () => {
    render(<><FocusTooltips /><button title="開く">a</button><button>b</button></>);
    const [a, b] = screen.getAllByRole("button");
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => { a.focus(); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByTestId("focus-tooltip")).not.toBeNull();
    fireEvent.keyDown(document.body, { key: "Tab" });
    act(() => { b.focus(); });
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByTestId("focus-tooltip")).toBeNull();
  });
});
