import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NotificationHistory } from "./NotificationHistory";
import { _resetToastHistory, showToast } from "../../utils/toast";
import { requestHeaderPanel } from "../../utils/headerPanels";

describe("NotificationHistory (ヘッダーの通知の履歴)", () => {
  beforeEach(() => { _resetToastHistory(); });

  it("見ていない失敗の数を印に出し、開くと数が消える。通知は新しい順に並ぶ", () => {
    render(<NotificationHistory />);
    expect(screen.queryByTestId("notif-badge")).toBeNull();
    act(() => { showToast("保存しました"); showToast("保存に失敗しました", "error"); });
    expect(screen.getByTestId("notif-badge").textContent).toBe("1");
    fireEvent.click(screen.getByTestId("notif-open"));
    expect(screen.queryByTestId("notif-badge")).toBeNull();
    const items = screen.getAllByTestId("notif-item");
    expect(items[0].textContent).toContain("保存に失敗しました");
    expect(items[1].textContent).toContain("保存しました");
  });

  it("やり直せる失敗には「再試行」が付き、押すと 1 回だけ実行される。すべて消すと空になる", () => {
    const retry = vi.fn();
    render(<NotificationHistory />);
    act(() => { showToast("ガジェットの保存に失敗しました", "error", { retry }); });
    fireEvent.click(screen.getByTestId("notif-open"));
    fireEvent.click(screen.getByTestId("notif-retry"));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("notif-retry")).toBeNull();
    fireEvent.click(screen.getByTestId("notif-clear"));
    expect(screen.getByText(/通知はまだありません/)).toBeInTheDocument();
  });

  it("Esc で閉じる (ボタンにフォーカスがあるときも)。コマンドからも開ける", () => {
    render(<NotificationHistory />);
    act(() => requestHeaderPanel("notifications"));
    expect(screen.getByTestId("notif-pop")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId("notif-open"), { key: "Escape" });
    expect(screen.queryByTestId("notif-pop")).toBeNull();
  });
});
