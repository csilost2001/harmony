import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StepInsertMenu, filterStepKinds } from "./StepInsertMenu";
import type { StepKind } from "../../../types/v3";

const KINDS = ["validation", "dbAccess", "branch", "screenTransition"] as StepKind[];

describe("filterStepKinds", () => {
  it("日本語名・種類名で絞る。空なら全部、空白区切りはすべて含むもの", () => {
    expect(filterStepKinds(KINDS, "")).toEqual(KINDS);
    expect(filterStepKinds(KINDS, "DB")).toEqual(["dbAccess"]);
    expect(filterStepKinds(KINDS, "分岐")).toEqual(["branch"]);
    expect(filterStepKinds(KINDS, "画面 遷移")).toEqual(["screenTransition"]);
    expect(filterStepKinds(KINDS, "zzz")).toEqual([]);
  });
});

describe("StepInsertMenu", () => {
  it("打ち込んで ↓ Enter で選べる。Esc でやめる", () => {
    const onPick = vi.fn(); const onClose = vi.fn();
    render(<StepInsertMenu kinds={KINDS} onPick={onPick} onClose={onClose} />);
    const input = screen.getByTestId("step-insert-input");
    fireEvent.change(input, { target: { value: "DB" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("dbAccess");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenLastCalledWith("dbAccess"); // 2 番目
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
  it("クリックでも選べる", () => {
    const onPick = vi.fn();
    render(<StepInsertMenu kinds={KINDS} onPick={onPick} onClose={vi.fn()} />);
    fireEvent.click(screen.getAllByTestId("step-insert-item")[2]);
    expect(onPick).toHaveBeenCalledWith("branch");
  });
});

describe("StepInsertMenu — この後によく置かれる種類", () => {
  const items = () => screen.getAllByTestId("step-insert-item").map((e) => e.getAttribute("data-kind"));

  it("suggest を渡すと、直前の工程に続く種類が上に出て「おすすめ」が付く。何も渡さなければ元の順", () => {
    const { unmount } = render(<StepInsertMenu kinds={KINDS} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(items()).toEqual(KINDS);
    expect(screen.queryAllByTestId("step-insert-suggest")).toHaveLength(0);
    unmount();

    render(<StepInsertMenu kinds={KINDS} suggest previousKind="validation" onPick={vi.fn()} onClose={vi.fn()} />);
    // 目安: validation の後は dbAccess → branch (compute は選べる種類に無い)
    expect(items().slice(0, 2)).toEqual(["dbAccess", "branch"]);
    expect(screen.getAllByTestId("step-insert-suggest")).toHaveLength(2);
  });

  it("入力すると、おすすめの並べ替えはせず、通常の絞り込みになる", () => {
    render(<StepInsertMenu kinds={KINDS} suggest previousKind="validation" onPick={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("step-insert-input"), { target: { value: "画面" } });
    expect(items()).toEqual(["screenTransition"]);
    expect(screen.queryAllByTestId("step-insert-suggest")).toHaveLength(0);
  });

  it("実績があれば実績を優先する", () => {
    const stats = new Map([["validation", new Map([["screenTransition", 5]])]]);
    render(<StepInsertMenu kinds={KINDS} suggest previousKind="validation" stats={stats} onPick={vi.fn()} onClose={vi.fn()} />);
    expect(items()[0]).toBe("screenTransition");
  });
});
