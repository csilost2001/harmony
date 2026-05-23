/**
 * ScreenItemsView 統合 component test scaffold (#1304)
 *
 * ScreenItemsView.tsx (約 1800 行、events panel / items table / fragments panel /
 * lintIssues 等) の統合 render baseline を担保する。
 *
 * mock 戦略:
 *   - 末端モジュール (mcpBridge / store 群 / schema) を vi.mock で固定
 *   - React hooks (useResourceEditor / useEditSession 等) は実 hook を使い、
 *     mcpBridge / store 経由の I/O をモック値で吸収する
 *     (hooks を mock すると実 hook の依存 import が二重変換されて OOM になるため)
 *   - 重い子コンポーネント (SaveConflictDialog / ResumeOrDiscardDialog 等) は no-op mock
 *
 * Step 2 (編集動作 test) は scope 外 — 後続 commit または follow-up ISSUE で追加。
 */
import { describe, it, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ---------------------------------------------------------------------------
// mcpBridge mock (最重要: html2canvas / grapesjs の重い import を遮断)
// ---------------------------------------------------------------------------
vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
    isConnected: () => false,
    getSessionId: () => "test-session-id",
    startWithoutEditor: vi.fn(),
    onStatusChange: vi.fn().mockReturnValue(() => {}),
    onBroadcast: vi.fn().mockReturnValue(() => {}),
    request: vi.fn().mockResolvedValue(null),
    getExtensions: vi.fn().mockResolvedValue({}),
    onExtensionsChanged: vi.fn().mockReturnValue(() => {}),
  },
}));

// ---------------------------------------------------------------------------
// store mocks (backend I/O を遮断)
// ---------------------------------------------------------------------------
vi.mock("../../store/flowStore", () => ({
  loadProject: vi.fn().mockResolvedValue({ screens: [] }),
}));

vi.mock("../../store/conventionsStore", () => ({
  loadConventions: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../store/processFlowStore", () => ({
  listProcessFlows: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../store/tableStore", () => ({
  listTables: vi.fn().mockResolvedValue([]),
  loadTable: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../store/viewStore", () => ({
  listViews: vi.fn().mockResolvedValue([]),
  loadView: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../store/genericDefinitionStore", () => ({
  listGenericDefinitions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../store/screenItemsStore", () => ({
  loadScreenItems: vi.fn().mockResolvedValue({
    screenId: "test-screen-id",
    updatedAt: "2026-01-01T00:00:00Z",
    items: [],
  }),
  saveScreenItems: vi.fn().mockResolvedValue(undefined),
  createEmptyScreenItems: vi.fn().mockReturnValue({
    screenId: "test-screen-id",
    updatedAt: "2026-01-01T00:00:00Z",
    items: [],
  }),
}));

// items 1 件 fixture (S-3 用: events toggle / fragments panel の render 条件を満たす)
const FIXTURE_SCREEN_ITEMS_ONE_ITEM = {
  screenId: "test-screen-id",
  updatedAt: "2026-01-01T00:00:00Z",
  items: [
    { id: "customerId", label: "顧客ID", type: "string" as const },
  ],
};

// ---------------------------------------------------------------------------
// schema / validator mocks (重い処理回避)
// ---------------------------------------------------------------------------
vi.mock("../../schemas/loadExtensions", () => ({
  loadExtensionsFromBundle: vi.fn().mockReturnValue({ extensions: {} }),
}));

vi.mock("../../schemas/conventionsValidator", () => ({
  checkScreenItemConventionReferences: vi.fn().mockReturnValue([]),
}));

// ---------------------------------------------------------------------------
// 重い子 component mocks (modal 系は DOM に出てこない方が test 軽い)
// ---------------------------------------------------------------------------
vi.mock("../editing/SaveConflictDialog", () => ({
  SaveConflictDialog: () => null,
}));
vi.mock("../editing/ResumeOrDiscardDialog", () => ({
  ResumeOrDiscardDialog: () => null,
}));
vi.mock("./ScreenItemCandidatesModal", () => ({
  ScreenItemCandidatesModal: () => null,
}));

// ---------------------------------------------------------------------------
// SUT import (vi.mock() hoisting 後)
// ---------------------------------------------------------------------------
import { ScreenItemsView } from "./ScreenItemsView";

// ---------------------------------------------------------------------------
// render helper
// ---------------------------------------------------------------------------
function renderWithRouter(screenId = "test-screen-id") {
  return render(
    <MemoryRouter initialEntries={[`/screen/items/${screenId}`]}>
      <Routes>
        <Route path="/screen/items/:screenId" element={<ScreenItemsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// tests (Step 1: scaffold render baseline)
// ---------------------------------------------------------------------------
describe("ScreenItemsView (統合 scaffold)", () => {
  it("1. 基本 render が成功する (例外なく描画)", () => {
    const { container } = renderWithRouter();
    expect(container.firstChild).not.toBeNull();
  });

  it("2. screen-items-view container が存在する", () => {
    const { container } = renderWithRouter();
    // ScreenItemsView のルート div は className "screen-items-view" を持つ
    const view = container.querySelector(".screen-items-view");
    expect(view).not.toBeNull();
  });

  it("3. items 0 件で items table 領域が render される (非同期ロード後)", async () => {
    const { container } = renderWithRouter();
    // items table は file ロード完了後に <table> 要素として描画される
    await waitFor(() => {
      const table = container.querySelector("table");
      expect(table).not.toBeNull();
    }, { timeout: 3000 });
  });

  it("4. items 1 件状態でイベント展開ボタン (toggle) が render される", async () => {
    // S-3: events panel の toggle button は items 行が存在する場合のみ render される
    // loadScreenItems を items 1 件返す fixture に差し替える
    const { loadScreenItems } = await import("../../store/screenItemsStore");
    vi.mocked(loadScreenItems).mockResolvedValueOnce(FIXTURE_SCREEN_ITEMS_ONE_ITEM);

    const { container } = renderWithRouter();
    // 非同期ロード完了後に items 行が描画される
    await waitFor(() => {
      // イベント展開ボタンは aria-label="イベント展開" で識別可能
      const eventToggleBtn = container.querySelector('[aria-label="イベント展開"]');
      expect(eventToggleBtn).not.toBeNull();
    }, { timeout: 3000 });
  });

  it("5. fragments panel が常に render される (.fragments-panel className 確認)", async () => {
    const { container } = renderWithRouter();
    // S-3: FragmentsPanel は items 数に関わらず常時 render (collapsible toggle UI)
    // .fragments-panel className は FragmentsPanel のルート div で必ず付与される
    await waitFor(() => {
      const fragmentsPanel = container.querySelector(".fragments-panel");
      expect(fragmentsPanel).not.toBeNull();
    }, { timeout: 3000 });
  });

  it("6. screen-items-toolbar と「項目追加」ボタンが render される", async () => {
    const { container } = renderWithRouter();
    // S-1: items 0 件でもツールバーは必ず render される
    // screen-items-toolbar div の存在と、その中の「項目追加」ボタンを具体的に確認
    await waitFor(() => {
      const toolbar = container.querySelector(".screen-items-toolbar");
      expect(toolbar).not.toBeNull();
      // 「項目追加」ボタン (.screen-items-add) が 1 つ以上存在すること
      const addButtons = container.querySelectorAll(".screen-items-add");
      expect(addButtons.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });
});
