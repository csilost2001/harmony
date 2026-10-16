import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { LoadingBlock } from "./LoadingBlock";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("LoadingBlock", () => {
  it("読み込み中の表示。しばらくは、再試行を出さない", () => {
    render(<LoadingBlock what="テーブル" />);
    expect(screen.getByTestId("loading-block")).toHaveTextContent("テーブルを読み込んでいます");
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.queryByTestId("loading-slow")).toBeNull();
  });
  it("6 秒たっても終わらなければ、時間がかかっていることと再試行を出す。押すと onRetry が呼ばれる", () => {
    const onRetry = vi.fn();
    render(<LoadingBlock what="帳票" onRetry={onRetry} />);
    act(() => { vi.advanceTimersByTime(6100); });
    expect(screen.getByTestId("loading-slow")).toHaveTextContent("時間がかかっています");
    fireEvent.click(screen.getByTestId("loading-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
