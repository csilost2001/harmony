import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { UndoHistoryPanel } from "./UndoHistoryPanel";

const table = (cols: Array<Record<string, unknown>>) => ({ id: "t", name: "注文", columns: cols });
const s0 = table([]);
const s1 = table([{ id: "c1", name: "注文ID" }]);
const s2 = table([{ id: "c1", name: "注文ID" }, { id: "c2", name: "数量" }]);

describe("UndoHistoryPanel", () => {
  it("操作が無ければボタンは押せない", () => {
    render(<UndoHistoryPanel history={{ past: [], future: [] }} present={s0} onJump={() => undefined} />);
    expect(screen.getByTestId("undo-history-open")).toBeDisabled();
  });

  it("開くと、操作を時間順に並べ、いまの状態と、やり直せる操作を見分けられる", () => {
    render(<UndoHistoryPanel history={{ past: [s0], future: [s2] }} present={s1} onJump={() => undefined} />);
    fireEvent.click(screen.getByTestId("undo-history-open"));
    const rows = screen.getAllByTestId("undo-history-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("注文ID");
    expect(rows[0].textContent).toContain("いま");
    expect(rows[0].querySelector("button")).toBeDisabled();
    expect(rows[1].textContent).toContain("やり直せる");
    expect(rows[1].textContent).toContain("数量");
  });

  it("行を選ぶと、その操作の後の状態へ移るための歩数で onJump を呼び、閉じる", () => {
    const onJump = vi.fn();
    render(<UndoHistoryPanel history={{ past: [s0, s1], future: [] }} present={s2} onJump={onJump} />);
    fireEvent.click(screen.getByTestId("undo-history-open"));
    const rows = screen.getAllByTestId("undo-history-row");
    expect(rows.map((r) => r.getAttribute("data-delta"))).toEqual(["-1", "0"]);
    fireEvent.click(rows[0].querySelector("button")!);
    expect(onJump).toHaveBeenCalledWith(-1);
    expect(screen.queryByTestId("undo-history")).toBeNull();
  });
});
