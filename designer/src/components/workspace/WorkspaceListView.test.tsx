import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceEntry, WorkspaceState } from "../../store/workspaceStore";

const navigateMock = vi.fn();
const openWorkspaceMock = vi.fn();

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

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    onStatusChange: vi.fn(() => () => {}),
  },
}));

vi.mock("../../store/workspaceStore", async () => {
  const actual = await vi.importActual<typeof import("../../store/workspaceStore")>("../../store/workspaceStore");
  return {
    ...actual,
    getState: vi.fn(() => state),
    subscribe: vi.fn(() => () => {}),
    loadWorkspaces: vi.fn(),
    openWorkspace: openWorkspaceMock,
    inspectWorkspace: vi.fn(),
    initAndOpen: vi.fn(),
    removeWorkspace: vi.fn(),
  };
});

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
});
