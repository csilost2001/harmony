import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QuickPickMenu } from "./QuickPickMenu";

const items = [
  { value: "section", label: "セクション", hint: "section" },
  { value: "form", label: "フォーム", hint: "form" },
  { value: "button", label: "ボタン", hint: "button" },
];
const values = () => screen.getAllByTestId("quick-pick-item").map((e) => e.getAttribute("data-value"));

describe("QuickPickMenu", () => {
  it("打ち込んで絞り込み (かな・全角半角・種類名)、↓ Enter で選ぶ", () => {
    const onPick = vi.fn();
    render(<QuickPickMenu title="部品を追加" items={items} onPick={onPick} onClose={vi.fn()} />);
    expect(values()).toEqual(["section", "form", "button"]);
    fireEvent.change(screen.getByTestId("quick-pick-input"), { target: { value: "ＦＯＲ" } });
    expect(values()).toEqual(["form"]);
    fireEvent.change(screen.getByTestId("quick-pick-input"), { target: { value: "" } });
    fireEvent.keyDown(screen.getByTestId("quick-pick-input"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByTestId("quick-pick-input"), { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("form");
  });

  it("日本語の変換中の Enter では選ばない / Esc で閉じる / 該当なしの案内", () => {
    const onPick = vi.fn(); const onClose = vi.fn();
    render(<QuickPickMenu title="部品を追加" items={items} onPick={onPick} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId("quick-pick-input"), { key: "Enter", isComposing: true });
    expect(onPick).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("quick-pick-input"), { target: { value: "zzz" } });
    expect(screen.getByText("該当するものがありません")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("クリックでも選べる", () => {
    const onPick = vi.fn();
    render(<QuickPickMenu title="t" items={items} onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByTestId("quick-pick-item")[2]);
    expect(onPick).toHaveBeenCalledWith("button");
  });
});
