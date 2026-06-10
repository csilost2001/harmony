import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceEntry, WorkspaceState } from "../../store/workspaceStore";

const navigateMock = vi.fn();
const openWorkspaceMock = vi.fn();
const loadWorkspacesMock = vi.fn(() => Promise.resolve());
const listWorkspaceRootsMock = vi.fn(() => Promise.resolve([]));

const workspace: WorkspaceEntry = {
  id: "ws-source",
  path: "workspaces/source",
  name: "Source",
  lastOpenedAt: null,
};

let state: WorkspaceState;

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

const onStatusChangeMock = vi.fn();

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    onStatusChange: onStatusChangeMock,
  },
}));

vi.mock("../../store/workspaceStore", async () => {
  const actual = await vi.importActual<typeof import("../../store/workspaceStore")>("../../store/workspaceStore");
  return {
    ...actual,
    getState: vi.fn(() => state),
    subscribe: vi.fn(() => () => {}),
    loadWorkspaces: loadWorkspacesMock,
    openWorkspace: openWorkspaceMock,
    inspectWorkspace: vi.fn(),
    initAndOpen: vi.fn(),
    removeWorkspace: vi.fn(),
    getHostInfo: vi.fn(() => Promise.resolve({ platform: "linux", isWSL: false, homeDir: "/home/user" })),
    listWorkspaceRoots: listWorkspaceRootsMock,
    addWorkspaceRoot: vi.fn(),
    removeWorkspaceRoot: vi.fn(),
    discoverWorkspaceCandidates: vi.fn(),
  };
});

vi.mock("./BackendFolderPicker", () => ({
  BackendFolderPicker: () => null,
}));

vi.mock("../common/DataList", () => ({
  DataList: ({ items, onActivate }: { items: WorkspaceEntry[]; onActivate: (item: WorkspaceEntry) => void }) => (
    <button type="button" data-testid="activate-workspace" onDoubleClick={() => onActivate(items[0])}>
      activate
    </button>
  ),
}));

vi.mock("../common/FilterBar", () => ({
  FilterBar: () => null,
}));

vi.mock("../common/SortBar", () => ({
  SortBar: () => null,
}));

vi.mock("../common/ViewModeToggle", () => ({
  ViewModeToggle: () => null,
}));

vi.mock("../../hooks/useListFilter", () => ({
  useListFilter: (items: WorkspaceEntry[]) => ({
    filtered: items,
    isActive: false,
    totalCount: items.length,
    visibleCount: items.length,
    applyFilter: vi.fn(),
    clearFilter: vi.fn(),
  }),
}));

vi.mock("../../hooks/useListSort", () => ({
  useListSort: (items: WorkspaceEntry[]) => ({
    sorted: items,
    sortKeys: [],
    toggleSort: vi.fn(),
    getSortDirection: vi.fn(() => null),
    getSortRank: vi.fn(() => null),
  }),
}));

vi.mock("../../hooks/useListSelection", () => ({
  useListSelection: () => ({
    selectedItems: [workspace],
    selectedIds: new Set([workspace.id]),
    isSelected: vi.fn((id: string) => id === workspace.id),
    handleRowClick: vi.fn(),
    clearSelection: vi.fn(),
    setSelectedIds: vi.fn(),
  }),
}));

vi.mock("../../hooks/usePersistentState", () => ({
  usePersistentState: () => ["card", vi.fn()],
}));

const { WorkspaceListView } = await import("./WorkspaceListView");

beforeEach(() => {
  navigateMock.mockReset();
  openWorkspaceMock.mockReset();
  openWorkspaceMock.mockResolvedValue("ws-target");
  loadWorkspacesMock.mockClear();
  listWorkspaceRootsMock.mockClear();
  onStatusChangeMock.mockReset();
  onStatusChangeMock.mockImplementation(() => () => {});
  state = {
    workspaces: [workspace],
    active: null,
    lockdown: false,
    lockdownPath: null,
    loading: false,
    error: null,
  };
});

describe("WorkspaceListView navigation", () => {
  it("shows workspace store errors after openWorkspace failure remounts the view", () => {
    state = {
      ...state,
      error: "ワークスペースの harmony.json が不正です",
    };

    render(<WorkspaceListView />);

    expect(screen.getByText(/harmony\.json が不正/)).toBeVisible();
  });

  it("open button navigates to the opened workspace root", async () => {
    const { container } = render(<WorkspaceListView />);

    const openButton = container.querySelector<HTMLButtonElement>(".table-list-actions .tbl-btn-ghost:not(.danger)");
    expect(openButton).not.toBeNull();
    fireEvent.click(openButton!);

    await waitFor(() => {
      expect(openWorkspaceMock).toHaveBeenCalledWith("ws-source", true);
      expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
    });
  });

  it("double-click activation navigates to the opened workspace root", async () => {
    render(<WorkspaceListView />);

    fireEvent.doubleClick(screen.getByTestId("activate-workspace"));

    await waitFor(() => {
      expect(openWorkspaceMock).toHaveBeenCalledWith("ws-source", true);
      expect(navigateMock).toHaveBeenCalledWith("/", { replace: true });
    });
  });

  it("does not mount workspace root panel in lockdown", () => {
    state = {
      ...state,
      lockdown: true,
      lockdownPath: "/locked/project",
    };

    render(<WorkspaceListView />);

    expect(screen.queryByText("プロジェクト探索ルート")).toBeNull();
    expect(listWorkspaceRootsMock).not.toHaveBeenCalled();
  });
});

describe("WorkspaceListView reload guard", () => {
  // 過去の regression: 初回即時発火の skip 判定で `workspaces.length > 0` を要求していたため、
  // recent が空 (= 初回起動) のときに loadWorkspaces → loading=true → AppShell スプラッシュ →
  // unmount/remount → 即時発火 … の無限ループで点滅していた。loading だけで判定する。
  it("skips loadWorkspaces on initial connected fire even when workspaces is empty", () => {
    state = {
      workspaces: [],
      active: null,
      lockdown: false,
      lockdownPath: null,
      loading: false,
      error: null,
    };
    onStatusChangeMock.mockImplementation((cb: (s: string) => void) => {
      cb("connected"); // mcpBridge.onStatusChange の即時発火を模す
      return () => {};
    });

    render(<WorkspaceListView />);

    expect(loadWorkspacesMock).not.toHaveBeenCalled();
  });

  it("reloads on reconnect (disconnected → connected) regardless of workspaces state", () => {
    state = {
      workspaces: [],
      active: null,
      lockdown: false,
      lockdownPath: null,
      loading: false,
      error: null,
    };
    onStatusChangeMock.mockImplementation((cb: (s: string) => void) => {
      cb("connected");    // 初回即時発火 → skip
      cb("disconnected"); // 切断
      cb("connected");    // 再接続 → reload
      return () => {};
    });

    render(<WorkspaceListView />);

    expect(loadWorkspacesMock).toHaveBeenCalledTimes(1);
  });
});
