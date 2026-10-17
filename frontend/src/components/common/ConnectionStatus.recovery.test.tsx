import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

type Cb = (s: string) => void;
let status = "connected";
const cbs = new Set<Cb>();
vi.mock("../../mcp/mcpBridge", () => ({ mcpBridge: { getStatus: () => status, onStatusChange: (cb: Cb) => { cbs.add(cb); cb(status); return () => cbs.delete(cb); } } }));
vi.mock("./ErrorDialogProvider", () => ({ useErrorDialog: () => ({ showError: vi.fn() }) }));
let drafts: Array<{ kind: string; id: string }> = [];
vi.mock("../../utils/draftStorage", () => ({ listAllDrafts: () => drafts }));
import { ConnectionStatus } from "./ConnectionStatus";

const emit = (s: string) => { status = s; act(() => { cbs.forEach((cb) => cb(s)); }); };

describe("接続が切れたあとの復帰 (続編 第 10 弾 #195)", () => {
  beforeEach(() => { status = "connected"; cbs.clear(); drafts = []; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("切れている間は、できること・できないことと、未保存の下書きの数を案内する", () => {
    drafts = [{ kind: "table", id: "orders" }, { kind: "process-flow", id: "f1" }];
    render(<ConnectionStatus />);
    emit("disconnected");
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByTestId("connection-help")).toBeNull();
    fireEvent.click(screen.getByTestId("connection-help-toggle"));
    const help = screen.getByTestId("connection-help").textContent ?? "";
    expect(help).toContain("できること");
    expect(help).toContain("できないこと");
    expect(help).toContain("未保存の下書き 2 件");
  });
  it("復旧したら、未保存の下書きがあることを知らせる。無ければ、知らせない", () => {
    drafts = [{ kind: "table", id: "orders" }];
    render(<ConnectionStatus />);
    emit("disconnected"); act(() => { vi.advanceTimersByTime(2000); });
    emit("connected"); act(() => { vi.advanceTimersByTime(10); });
    expect(screen.getByTestId("connection-status").textContent).toContain("未保存の下書きが 1 件あります");
    act(() => { vi.advanceTimersByTime(3500); });
    drafts = [];
    emit("disconnected"); act(() => { vi.advanceTimersByTime(2000); });
    emit("connected"); act(() => { vi.advanceTimersByTime(10); });
    expect(screen.getByTestId("connection-status").textContent).not.toContain("未保存");
  });
});
