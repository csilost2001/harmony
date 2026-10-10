import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

type Cb = (s: string) => void;
let status = "connected";
const cbs = new Set<Cb>();
vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    getStatus: () => status,
    onStatusChange: (cb: Cb) => { cbs.add(cb); cb(status); return () => cbs.delete(cb); },
  },
}));
const showError = vi.fn();
vi.mock("./ErrorDialogProvider", () => ({ useErrorDialog: () => ({ showError }) }));
import { ConnectionStatus } from "./ConnectionStatus";
import { isConnectionError } from "../../utils/connectionError";

const emit = (s: string) => { status = s; act(() => { cbs.forEach((cb) => cb(s)); }); };

describe("ConnectionStatus", () => {
  beforeEach(() => { status = "connected"; cbs.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("接続できているあいだは何も出さない", () => {
    render(<ConnectionStatus />);
    expect(screen.queryByTestId("connection-status")).toBeNull();
  });

  it("切れて猶予を過ぎたら知らせ、復旧したら『復旧しました』を出してから消える", () => {
    render(<ConnectionStatus />);
    emit("disconnected");
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByTestId("connection-status")).toBeNull();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByTestId("connection-status").textContent).toContain("接続が切れています");
    emit("connected");
    act(() => { vi.advanceTimersByTime(10); });
    expect(screen.getByTestId("connection-status").textContent).toContain("復旧しました");
    act(() => { vi.advanceTimersByTime(3500); });
    expect(screen.queryByTestId("connection-status")).toBeNull();
  });

  it("一瞬の切断 (猶予内に復旧) では出さない", () => {
    render(<ConnectionStatus />);
    emit("disconnected");
    act(() => { vi.advanceTimersByTime(800); });
    emit("connected");
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByTestId("connection-status")).toBeNull();
  });

  it("最初から接続できていない (まだ一度も接続していない) ときは出さない", () => {
    status = "connecting";
    render(<ConnectionStatus />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.queryByTestId("connection-status")).toBeNull();
  });
});

describe("接続できないために失敗した操作の知らせ", () => {
  beforeEach(() => { status = "connected"; cbs.clear(); showError.mockClear(); });

  it("接続に関する失敗かどうかを判定する", () => {
    expect(isConnectionError(new Error("wsBridge に接続されていません"))).toBe(true);
    expect(isConnectionError(new Error("WebSocket が切断されました"))).toBe(true);
    expect(isConnectionError(new Error("別のエラー"))).toBe(false);
    expect(isConnectionError(undefined)).toBe(false);
  });

  it("接続の失敗は 1 度だけ知らせる (続けて起きても出し続けない)。別の失敗は知らせない", () => {
    render(<ConnectionStatus />);
    const fire = (reason: unknown) => {
      const ev = new Event("unhandledrejection") as Event & { reason: unknown };
      ev.reason = reason;
      act(() => { window.dispatchEvent(ev); });
    };
    fire(new Error("関係のない失敗"));
    expect(showError).not.toHaveBeenCalled();
    fire(new Error("wsBridge に接続されていません"));
    fire(new Error("wsBridge に接続されていません"));
    expect(showError).toHaveBeenCalledTimes(1);
    expect(showError.mock.calls[0][0].title).toContain("サーバに接続できない");
  });
});
