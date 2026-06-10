import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bridgeMock = vi.hoisted(() => ({
  request: vi.fn(),
  statusCallbacks: [] as Array<(status: string) => void>,
  broadcastCallbacks: [] as Array<(data: unknown) => void>,
}));

vi.mock("../mcp/mcpBridge", () => ({
  mcpBridge: {
    request: bridgeMock.request,
    onStatusChange: vi.fn((cb: (status: string) => void) => {
      bridgeMock.statusCallbacks.push(cb);
      return () => {};
    }),
    onBroadcast: vi.fn((_event: string, cb: (data: unknown) => void) => {
      bridgeMock.broadcastCallbacks.push(cb);
      return () => {};
    }),
    startWithoutEditor: vi.fn(),
    markFailed: vi.fn(),
  },
}));

vi.mock("./flow/FlowEditor", () => ({ FlowEditor: () => <div data-testid="flow-editor" /> }));
vi.mock("./flow/ScreenListView", () => ({ ScreenListView: () => <div data-testid="screen-list" /> }));
vi.mock("./table/TableListView", () => ({ TableListView: () => <div /> }));
vi.mock("./table/TableEditor", () => ({ TableEditor: () => <div /> }));
vi.mock("./table/ErDiagram", () => ({ ErDiagram: () => <div /> }));
vi.mock("./process-flow/ProcessFlowListView", () => ({ ProcessFlowListView: () => <div /> }));
vi.mock("./process-flow/ProcessFlowEditor", () => ({ ProcessFlowEditor: () => <div /> }));
vi.mock("./extensions/ExtensionsPanel", () => ({ ExtensionsPanel: () => <div /> }));
vi.mock("./conventions/ConventionsCatalogView", () => ({ ConventionsCatalogView: () => <div /> }));
vi.mock("./screen-items/ScreenItemsView", () => ({ ScreenItemsView: () => <div /> }));
vi.mock("./sequence/SequenceListView", () => ({ SequenceListView: () => <div /> }));
vi.mock("./sequence/SequenceEditor", () => ({ SequenceEditor: () => <div /> }));
vi.mock("./view/ViewListView", () => ({ ViewListView: () => <div /> }));
vi.mock("./view/ViewEditor", () => ({ ViewEditor: () => <div /> }));
vi.mock("./view-definition/ViewDefinitionListView", () => ({ ViewDefinitionListView: () => <div /> }));
vi.mock("./view-definition/ViewDefinitionEditor", () => ({ ViewDefinitionEditor: () => <div /> }));
vi.mock("./page-layout/PageLayoutListView", () => ({ PageLayoutListView: () => <div /> }));
vi.mock("./page-layout/PageLayoutEditor", () => ({ PageLayoutEditor: () => <div /> }));
vi.mock("./page-layout/PageLayoutDesigner", () => ({ PageLayoutDesigner: () => <div /> }));
vi.mock("./gadget/GadgetListView", () => ({ GadgetListView: () => <div /> }));
vi.mock("./generic-definition/GenericDefinitionCatalogView", () => ({ GenericDefinitionCatalogView: () => <div /> }));
vi.mock("./generic-definition/GenericDefinitionListView", () => ({ GenericDefinitionListView: () => <div /> }));
vi.mock("./generic-definition/GenericDefinitionEditor", () => ({ GenericDefinitionEditor: () => <div /> }));
vi.mock("./workspace/WorkspaceListView", () => ({ WorkspaceListView: () => <div data-testid="workspace-list" /> }));
vi.mock("./workspace/WorkspaceSelectView", () => ({ WorkspaceSelectView: () => <div data-testid="workspace-select" /> }));
vi.mock("./project/TechStackView", () => ({ TechStackView: () => <div /> }));
vi.mock("./DesignerTabHost", () => ({ DesignerTabHost: () => <div /> }));
vi.mock("./codex/CodexSettingsView", () => ({ CodexSettingsView: () => <div /> }));
vi.mock("./dashboard/DashboardView", () => ({ DashboardView: () => <div data-testid="dashboard" /> }));
vi.mock("./TabBar", () => ({ TabBar: () => <div /> }));
vi.mock("./CommonHeader", () => ({ CommonHeader: () => <div /> }));
vi.mock("./common/ErrorBoundary", () => ({ ErrorBoundary: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./common/ErrorFallback", () => ({ TabErrorFallback: () => <div /> }));
vi.mock("./common/ResourceLoading", () => ({ ResourceLoading: () => <div /> }));
vi.mock("./common/ErrorDialogProvider", () => ({ useErrorDialog: () => ({ showError: vi.fn() }) }));
vi.mock("../hooks/useTabKeyboard", () => ({ useTabKeyboard: vi.fn() }));
vi.mock("../store/flowStore", () => ({ loadProject: vi.fn() }));
vi.mock("../store/tableStore", () => ({ loadTable: vi.fn() }));
vi.mock("../store/processFlowStore", () => ({ loadProcessFlow: vi.fn() }));
vi.mock("../store/sequenceStore", () => ({ loadSequence: vi.fn() }));
vi.mock("../store/viewStore", () => ({ loadView: vi.fn() }));
vi.mock("../store/viewDefinitionStore", () => ({ loadViewDefinition: vi.fn() }));
vi.mock("../store/pageLayoutStore", () => ({ loadPageLayout: vi.fn() }));
vi.mock("../store/genericDefinitionStore", () => ({ loadGenericDefinition: vi.fn() }));
vi.mock("../store/tabStore", () => ({
  getTabs: vi.fn(() => []),
  getActiveTabId: vi.fn(() => null),
  subscribe: vi.fn(() => () => {}),
  openTab: vi.fn(),
  setActiveTab: vi.fn(),
  closeTab: vi.fn(),
  makeTabId: vi.fn((type: string, id: string) => `${type}:${id}`),
  clearPersistedTabs: vi.fn(),
}));
vi.mock("../utils/redirectGuard", () => ({
  checkRedirect: vi.fn(() => ({ allow: true })),
  subscribeRedirectGuardTrip: vi.fn(() => () => {}),
  isRedirectGuardTripped: vi.fn(() => false),
}));
vi.mock("../utils/uiLog", () => ({
  uiInfo: vi.fn(),
  uiWarn: vi.fn(),
  setupServerLogFlush: vi.fn(() => () => {}),
}));
vi.mock("../utils/errorLog", () => ({ recordError: vi.fn() }));

describe("AppShell workspace initial restore", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    bridgeMock.statusCallbacks.length = 0;
    bridgeMock.broadcastCallbacks.length = 0;
    const workspaceStore = await import("../store/workspaceStore");
    workspaceStore.__resetStateForTest();
    workspaceStore.__resetLoadChainForTest();
    bridgeMock.request.mockImplementation(async (method: string) => {
      if (method === "workspace.list") {
        return {
          workspaces: [{ id: "ws-aaa", path: "/data/ws-aaa", name: "WS A", lastOpenedAt: null }],
          lastActiveId: "ws-aaa",
          active: { id: "ws-aaa", path: "/data/ws-aaa", name: "WS A" },
          lockdown: false,
          lockdownPath: null,
        };
      }
      if (method === "workspace.open") {
        throw new Error("open failed");
      }
      return {};
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initial restore が失敗したら spinner 固定ではなく workspace select へ戻す", async () => {
    const { AppShell } = await import("./AppShell");
    render(
      <MemoryRouter initialEntries={["/w/ws-aaa/screen/list"]}>
        <AppShell />
      </MemoryRouter>,
    );

    bridgeMock.statusCallbacks.forEach((cb) => cb("connected"));

    await waitFor(() => {
      expect(bridgeMock.request).toHaveBeenCalledWith("workspace.open", { id: "ws-aaa" });
    });
    await waitFor(() => {
      expect(screen.getByTestId("workspace-select")).toBeInTheDocument();
    });
    expect(screen.queryByText("ワークスペースを開いています...")).not.toBeInTheDocument();
  });
});
