/** 設計の完成度パネル: 種類別の集計・確定の割合・記録の要求・設計の分析への導線 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { tiny } from "../../analysis/logic/fixtures";

const request = vi.fn();
let onBroadcast: (ev: string, cb: () => void) => () => void;
vi.mock("../../../mcp/mcpBridge", () => ({
  mcpBridge: { request: (...a: unknown[]) => request(...a), onBroadcast: (ev: string, cb: () => void) => onBroadcast(ev, cb), onStatusChange: () => () => undefined },
}));
const loadDesignInput = vi.fn();
vi.mock("../../document/loadDesignInput", () => ({ loadDesignInput: () => loadDesignInput() }));
vi.mock("../../../hooks/useWorkspacePath", () => ({ useWorkspacePath: () => ({ wsPath: (p: string) => `/w/x${p}` }) }));
import { DesignProgressPanel } from "./DesignProgressPanel";

const Where = () => <span data-testid="where">{useLocation().pathname}</span>;
const renderPanel = () => render(<MemoryRouter><DesignProgressPanel /><Routes><Route path="*" element={<Where />} /></Routes></MemoryRouter>);

beforeEach(() => {
  request.mockReset(); loadDesignInput.mockReset();
  request.mockResolvedValue({ summary: {}, history: [] });
  onBroadcast = () => () => undefined;
});

describe("DesignProgressPanel", () => {
  it("確定の割合と、種類ごとの件数を出し、その日の記録を求める。設計の分析へ移動できる", async () => {
    const input = tiny();
    (input.screens[0] as unknown as { maturity: string }).maturity = "committed";
    loadDesignInput.mockResolvedValue({ input, skipped: [] });
    renderPanel();
    expect((await screen.findByTestId("design-progress-pct")).textContent).toBe("12.5%"); // 8 件のうち 1 件が確定
    const panel = screen.getByTestId("design-progress-panel");
    expect(panel.textContent).toContain("確定 (1 / 8 件)");
    expect(panel.textContent).toContain("画面");
    expect(panel.textContent).not.toContain("帳票"); // 0 件の種類は出さない
    await waitFor(() => expect(request).toHaveBeenCalledWith("design.progress", { record: true }));
    fireEvent.click(screen.getByTestId("design-progress-open"));
    expect(screen.getByTestId("where").textContent).toBe("/w/x/analysis");
  });

  it("設計が無ければ、その旨を出す。読み込みに失敗したら、理由を出す", async () => {
    loadDesignInput.mockResolvedValue({ input: { project: { name: "x" }, screens: [], flows: [], tables: [] }, skipped: [] });
    const { unmount } = renderPanel();
    expect((await screen.findByTestId("design-progress-panel")).textContent).toContain("集計するものがありません");
    unmount();
    loadDesignInput.mockRejectedValue(new Error("つながりません"));
    renderPanel();
    expect((await screen.findByText(/集計失敗: つながりません/))).toBeTruthy();
  });

  it("設計が変わった通知で、集計し直す", async () => {
    const cbs: Array<() => void> = [];
    onBroadcast = (_ev, cb) => { cbs.push(cb); return () => undefined; };
    loadDesignInput.mockResolvedValue({ input: tiny(), skipped: [] });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderPanel();
      await screen.findByTestId("design-progress-pct");
      const before = loadDesignInput.mock.calls.length;
      cbs.forEach((cb) => cb());
      await vi.advanceTimersByTimeAsync(700);
      await waitFor(() => expect(loadDesignInput.mock.calls.length).toBe(before + 1)); // 続けて起きても 1 回
    } finally { vi.useRealTimers(); }
  });
});
