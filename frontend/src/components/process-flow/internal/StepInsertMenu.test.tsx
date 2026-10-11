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
