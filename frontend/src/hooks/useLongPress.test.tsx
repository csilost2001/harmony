import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useLongPress } from "./useLongPress";

const ev = (over: Partial<{ pointerType: string; x: number; y: number; isPrimary: boolean }> = {}) =>
  ({ pointerType: over.pointerType ?? "touch", clientX: over.x ?? 10, clientY: over.y ?? 20, isPrimary: over.isPrimary ?? true, nativeEvent: {} }) as unknown as ReactPointerEvent;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("useLongPress", () => {
  it("タッチを押し続けると、その位置で呼ばれる", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress(fn));
    act(() => { result.current.onPointerDown(ev()); });
    act(() => { vi.advanceTimersByTime(300); });
    expect(fn).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(400); });
    expect(fn).toHaveBeenCalledWith(10, 20);
  });
  it("離す・大きく動かす・マウスのときは、呼ばれない。少しの揺れは許す", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress(fn));
    act(() => { result.current.onPointerDown(ev()); result.current.onPointerUp(); vi.advanceTimersByTime(1000); });
    act(() => { result.current.onPointerDown(ev()); result.current.onPointerMove(ev({ x: 40, y: 20 })); vi.advanceTimersByTime(1000); });
    act(() => { result.current.onPointerDown(ev({ pointerType: "mouse" })); vi.advanceTimersByTime(1000); });
    expect(fn).not.toHaveBeenCalled();
    act(() => { result.current.onPointerDown(ev()); result.current.onPointerMove(ev({ x: 14, y: 22 })); vi.advanceTimersByTime(1000); });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("無効のときは、何もしない", () => {
    const fn = vi.fn();
    const { result } = renderHook(() => useLongPress(fn, false));
    act(() => { result.current.onPointerDown(ev()); vi.advanceTimersByTime(1000); });
    expect(fn).not.toHaveBeenCalled();
  });
});
