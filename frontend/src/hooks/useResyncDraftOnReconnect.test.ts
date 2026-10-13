import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

let statusCb: ((s: string) => void) | null = null;
const unsub = vi.fn();
vi.mock("../mcp/mcpBridge", () => ({
  mcpBridge: { onStatusChange: (cb: (s: string) => void) => { statusCb = cb; return unsub; } },
}));
import { useResyncDraftOnReconnect } from "./useResyncDraftOnReconnect";

beforeEach(() => { statusCb = null; unsub.mockClear(); });

describe("useResyncDraftOnReconnect", () => {
  it("編集中 (変更あり) に接続が戻ったとき、下書きへ送り直す", () => {
    const push = vi.fn();
    renderHook(() => useResyncDraftOnReconnect(true, true, push));
    statusCb?.("disconnected");
    expect(push).not.toHaveBeenCalled();
    statusCb?.("connected");
    expect(push).toHaveBeenCalledTimes(1);
  });

  it("変更が無いとき・編集中でないときは送らない", () => {
    const clean = vi.fn();
    renderHook(() => useResyncDraftOnReconnect(true, false, clean));
    statusCb?.("connected");
    expect(clean).not.toHaveBeenCalled();

    statusCb = null;
    const inactive = vi.fn();
    renderHook(() => useResyncDraftOnReconnect(false, true, inactive));
    expect(statusCb).toBeNull(); // 編集中でないときは、購読もしない
  });

  it("最新の変更の有無・送る関数を使う (再描画のたびに購読し直さない)", () => {
    const first = vi.fn(), second = vi.fn();
    const { rerender } = renderHook(({ dirty, push }) => useResyncDraftOnReconnect(true, dirty, push), { initialProps: { dirty: false, push: first } });
    rerender({ dirty: true, push: second });
    statusCb?.("connected");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(unsub).not.toHaveBeenCalled();
  });

  it("アンマウントで購読を解く", () => {
    const { unmount } = renderHook(() => useResyncDraftOnReconnect(true, true, vi.fn()));
    unmount();
    expect(unsub).toHaveBeenCalledTimes(1);
  });
});
