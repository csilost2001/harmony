import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ToastHost } from "./ToastHost";
import { showToast } from "../../utils/toast";

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
});
