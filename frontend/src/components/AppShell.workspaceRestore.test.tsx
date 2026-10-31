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
vi.mock("./common/ResourceLoading", () => ({ ResourceLoading: () => <div />, ViewLoading: () => <div /> }));
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
      expect(bridgeMock.request).toHaveBeenCalledWith("workspace.open", { id: "ws-aaa", restore: true });
    });
    await waitFor(() => {
      expect(screen.getByTestId("workspace-select")).toBeInTheDocument();
    });
    expect(screen.queryByText("ワークスペースを開いています...")).not.toBeInTheDocument();
  });
});

describe("AppShell routing guard restore", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    bridgeMock.statusCallbacks.length = 0;
    bridgeMock.broadcastCallbacks.length = 0;
    const workspaceStore = await import("../store/workspaceStore");
    workspaceStore.__resetStateForTest();
    workspaceStore.__resetLoadChainForTest();
    // 画面は ws-bbb の URL、backend の作業先は ws-aaa。open が成功したら ws-bbb に変わる
    let activeId = "ws-aaa";
    const workspaces = [
      { id: "ws-aaa", path: "/data/ws-aaa", name: "WS A", lastOpenedAt: null },
      { id: "ws-bbb", path: "/data/ws-bbb", name: "WS B", lastOpenedAt: null },
    ];
    bridgeMock.request.mockImplementation(async (method: string, params?: { id?: string }) => {
      if (method === "workspace.list") {
        const a = workspaces.find((w) => w.id === activeId)!;
        return {
          workspaces,
          lastActiveId: "ws-aaa",
          active: { id: a.id, path: a.path, name: a.name },
          lockdown: false,
          lockdownPath: null,
        };
      }
      if (method === "workspace.open") {
        activeId = params?.id ?? activeId;
        return { active: { id: activeId } };
      }
      return {};
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("URL のワークスペースが active と異なるときの同期 (ルーティングの見張り) の workspace.open も restore: true で呼ぶ", async () => {
    const { AppShell } = await import("./AppShell");
    render(
      <MemoryRouter initialEntries={["/w/ws-bbb/screen/list"]}>
        <AppShell />
      </MemoryRouter>,
    );

    bridgeMock.statusCallbacks.forEach((cb) => cb("connected"));

    await waitFor(() => {
      expect(bridgeMock.request).toHaveBeenCalledWith("workspace.open", { id: "ws-bbb", restore: true });
    });
    // restore なしの open (最後に開いたワークスペースを動かす呼び方) は一度も出ない
    const opens = bridgeMock.request.mock.calls.filter((c) => c[0] === "workspace.open");
    expect(opens.every((c) => (c[1] as { restore?: boolean }).restore === true)).toBe(true);
  });
});

describe("AppShell 画面が古いとき (#1572)", () => {
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
          workspaces: [
            { id: "ws-aaa", path: "/data/ws-aaa", name: "WS A", lastOpenedAt: null },
            { id: "ws-bbb", path: "/data/ws-bbb", name: "WS B", lastOpenedAt: null },
          ],
          lastActiveId: "ws-aaa",
          active: { id: "ws-aaa", path: "/data/ws-aaa", name: "WS A" },
          lockdown: false,
          lockdownPath: null,
        };
      }
      return {};
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    (await import("../utils/buildVersion")).__resetStaleBuildForTest();
    vi.restoreAllMocks();
  });

  it.each([
    ["初回の復元 (URL と active が同じ)", "/w/ws-aaa/screen/list"],
    ["ルーティングの見張り (URL と active が違う)", "/w/ws-bbb/screen/list"],
  ])("サーバの版と違う間は workspace.open を出さず、更新バナーを出す: %s", async (_label, url) => {
    vi.stubGlobal("__HARMONY_BUILD_ID__", "client-1");
    const { handleServerBuildId } = await import("../utils/buildVersion");
    handleServerBuildId("server-2");
    const { AppShell } = await import("./AppShell");
    render(
      <MemoryRouter initialEntries={[url]}>
        <AppShell />
      </MemoryRouter>,
    );

    bridgeMock.statusCallbacks.forEach((cb) => cb("connected"));

    await waitFor(() => {
      expect(screen.getByTestId("stale-build-banner")).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(bridgeMock.request.mock.calls.some((c) => c[0] === "workspace.list")).toBe(true);
    });
    // 見張りの effect が走る時間を与えても、workspace.open は出ない
    await new Promise((r) => setTimeout(r, 50));
    expect(bridgeMock.request.mock.calls.some((c) => c[0] === "workspace.open")).toBe(false);
  });

  it("表示のあとで古いと分かった場合も、それ以後は workspace.open を出さない。版が一致に戻ると出る", async () => {
    vi.stubGlobal("__HARMONY_BUILD_ID__", "client-1");
    const { handleServerBuildId } = await import("../utils/buildVersion");
    // workspace.list の応答を止めておき、画面を出したあとに registered が届いた状態を作る
    let releaseList: () => void = () => {};
    const listGate = new Promise<void>((r) => { releaseList = r; });
    const base = bridgeMock.request.getMockImplementation()!;
    bridgeMock.request.mockImplementation(async (method: string, params?: unknown) => {
      if (method === "workspace.list") await listGate;
      return base(method, params);
    });
    const { AppShell } = await import("./AppShell");
    render(
      <MemoryRouter initialEntries={["/w/ws-bbb/screen/list"]}>
        <AppShell />
      </MemoryRouter>,
    );
    bridgeMock.statusCallbacks.forEach((cb) => cb("connected"));

    handleServerBuildId("server-2");
    releaseList();
    await waitFor(() => {
      expect(screen.getByTestId("stale-build-banner")).toBeInTheDocument();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(bridgeMock.request.mock.calls.some((c) => c[0] === "workspace.open")).toBe(false);

    // 版が一致に戻る (新しい画面で開き直した場合など) と、止めていた workspace.open が出る
    handleServerBuildId("client-1");
    await waitFor(() => {
      expect(bridgeMock.request).toHaveBeenCalledWith("workspace.open", { id: "ws-bbb", restore: true });
    });
  });

  it("リダイレクトの停止の知らせが出ている間は、更新バナーを重ねて出さない", async () => {
    vi.stubGlobal("__HARMONY_BUILD_ID__", "client-1");
    const guard = await import("../utils/redirectGuard");
    vi.mocked(guard.isRedirectGuardTripped).mockReturnValue(true);
    try {
      const { handleServerBuildId } = await import("../utils/buildVersion");
      handleServerBuildId("server-2");
      const { AppShell } = await import("./AppShell");
      render(
        <MemoryRouter initialEntries={["/w/ws-aaa/screen/list"]}>
          <AppShell />
        </MemoryRouter>,
      );
      bridgeMock.statusCallbacks.forEach((cb) => cb("connected"));
      await waitFor(() => {
        expect(screen.getByText(/リダイレクトループ検出/)).toBeInTheDocument();
      });
      expect(screen.queryByTestId("stale-build-banner")).not.toBeInTheDocument();
    } finally {
      vi.mocked(guard.isRedirectGuardTripped).mockReturnValue(false);
    }
  });
});
