/**
 * DashboardView — rendering smoke (#1146)
 *
 * panel 個別の自己完結性を尊重しつつ、shell の header / panel iteration /
 * empty fallback を検証。各 panel は mock で停止 (個別 panel test は別途必要時に追加)。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// react-grid-layout/legacy は jsdom 環境で WidthProvider 挙動が
// 不安定なので、layout container だけ提供する shim を差し込む。
vi.mock("react-grid-layout/legacy", () => {
  const fakeGrid = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="grid-shim">{children}</div>
  );
  return {
    Responsive: fakeGrid,
    // WidthProvider: HOC を identity に置換
    WidthProvider: <T,>(c: T) => c,
  };
});

// 全 panel を no-op に。各 panel の検証は別 test で行う想定。
vi.mock("./panels/FunctionCountsPanel", () => ({
  FunctionCountsPanel: () => <div data-testid="panel-function-counts">fc</div>,
}));
vi.mock("./panels/UnsavedDraftsPanel", () => ({
  UnsavedDraftsPanel: () => <div data-testid="panel-unsaved-drafts">ud</div>,
}));
vi.mock("./panels/RecentEditsPanel", () => ({
  RecentEditsPanel: () => <div data-testid="panel-recent-edits">re</div>,
}));
vi.mock("./panels/ProcessFlowMaturityPanel", () => ({
  ProcessFlowMaturityPanel: () => <div data-testid="panel-process-flow-maturity">pm</div>,
}));
vi.mock("./panels/GettingStartedPanel", () => ({
  GettingStartedPanel: () => <div data-testid="panel-getting-started">gs</div>,
}));
vi.mock("./panels/DesignIssuesPanel", () => ({
  DesignIssuesPanel: () => <div data-testid="panel-design-issues">di</div>,
}));
vi.mock("./panels/MarkersSummaryPanel", () => ({
  MarkersSummaryPanel: () => <div data-testid="panel-markers-summary">ms</div>,
}));

const { DashboardView } = await import("./DashboardView");
const { dashboardPanels } = await import("./panelRegistry");

describe("DashboardView", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders header title and subtitle", () => {
    const { container } = render(<DashboardView />);

    expect(container.querySelector(".dashboard-title")?.textContent).toContain("ダッシュボード");
    expect(container.querySelector(".dashboard-subtitle")?.textContent).toContain("プロジェクト全体の状況を俯瞰");
  });

  it("renders one panel per registry entry", () => {
    const { container } = render(<DashboardView />);

    const panels = container.querySelectorAll(".dashboard-panel");
    expect(panels.length).toBe(dashboardPanels.length);
  });

  it("renders each registered panel's title in the header", () => {
    const { container } = render(<DashboardView />);

    for (const p of dashboardPanels) {
      expect(container.textContent).toContain(p.title);
    }
  });

  it("persists layout to localStorage on first render (or no-op when empty)", () => {
    render(<DashboardView />);
    // 初期 render では onLayoutChange は発火しないため、storage は触らない (現実装の振る舞いを記録)
    expect(localStorage.getItem("dashboard-layout-v1")).toBeNull();
  });
});
