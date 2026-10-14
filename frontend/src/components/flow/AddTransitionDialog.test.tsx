import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AddTransitionDialog } from "./AddTransitionDialog";

const screens = [{ id: "a", name: "一覧" }, { id: "b", name: "詳細" }, { id: "c", name: "完了" }];

describe("AddTransitionDialog", () => {
  it("遷移元・遷移先を選んで追加する。既定は、先頭 → 2 番目", () => {
    const onAdd = vi.fn(); const onClose = vi.fn();
    render(<AddTransitionDialog screens={screens} onAdd={onAdd} onClose={onClose} />);
    expect((screen.getByTestId("add-transition-source") as HTMLSelectElement).value).toBe("a");
    expect((screen.getByTestId("add-transition-target") as HTMLSelectElement).value).toBe("b");
    fireEvent.change(screen.getByTestId("add-transition-target"), { target: { value: "c" } });
    fireEvent.click(screen.getByTestId("add-transition-apply"));
    expect(onAdd).toHaveBeenCalledWith("a", "c");
    expect(onClose).toHaveBeenCalled();
  });

  it("Esc で閉じ、追加はしない。画面が 1 つなら、自分自身への遷移が既定", () => {
    const onAdd = vi.fn(); const onClose = vi.fn();
    render(<AddTransitionDialog screens={[screens[0]]} onAdd={onAdd} onClose={onClose} />);
    expect((screen.getByTestId("add-transition-target") as HTMLSelectElement).value).toBe("a");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    expect(onAdd).not.toHaveBeenCalled();
  });
});
