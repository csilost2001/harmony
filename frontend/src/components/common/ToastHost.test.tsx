import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ToastHost } from "./ToastHost";
import { getToastHistory, showToast } from "../../utils/toast";

afterEach(() => { vi.useRealTimers(); });

describe("ToastHost", () => {
  it("通知を出し、しばらくして消す。同時には最大 3 件", () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    expect(screen.queryByTestId("toast")).toBeNull();
    act(() => { showToast("保存しました"); });
    expect(screen.getByTestId("toast").textContent).toContain("保存しました");
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByTestId("toast")).toBeNull();
    act(() => { for (let i = 0; i < 5; i++) showToast(`n${i}`); });
    expect(screen.getAllByTestId("toast")).toHaveLength(3);
  });

  it("「元に戻す」付きの通知: 押すと実行して消える。履歴には、元に戻すを残さない", () => {
    const undo = vi.fn();
    render(<ToastHost />);
    act(() => { showToast("消しました", "info", { undo }); });
    expect(getToastHistory()[0].undo).toBeUndefined();
    fireEvent.click(screen.getByTestId("toast-undo"));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("toast")).toBeNull();
  });
});
