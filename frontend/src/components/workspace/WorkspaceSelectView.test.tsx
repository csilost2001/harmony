import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceState } from "../../store/workspaceStore";

const navigateMock = vi.fn();
let state: WorkspaceState;

vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    startWithoutEditor: vi.fn(),
    onStatusChange: vi.fn(() => () => {}),
  },
}));

vi.mock("../../store/workspaceStore", async () => {
  const actual = await vi.importActual<typeof import("../../store/workspaceStore")>("../../store/workspaceStore");
  return {
    ...actual,
    getState: vi.fn(() => state),
    subscribe: vi.fn(() => () => {}),
    loadWorkspaces: vi.fn(() => Promise.resolve()),
    openWorkspace: vi.fn(),
  };
});

vi.mock("./WorkspaceListView", () => ({
  AddWorkspaceDialog: () => null,
}));

const { WorkspaceSelectView } = await import("./WorkspaceSelectView");

beforeEach(() => {
  navigateMock.mockReset();
  state = {
    workspaces: [],
    active: null,
    lockdown: false,
    lockdownPath: null,
    loading: false,
    error: null,
  };
});

describe("WorkspaceSelectView", () => {
  it("shows workspace store errors after openWorkspace failure remounts the view", () => {
    state = {
      ...state,
      error: "ワークスペースの harmony.json が不正です",
    };

    render(<WorkspaceSelectView />);

    expect(screen.getByText(/harmony\.json が不正/)).toBeVisible();
  });

  it("does not show the e2e bypass sentinel as a user-facing error", () => {
    state = {
      ...state,
      error: "e2e bypass",
    };

    render(<WorkspaceSelectView />);

    expect(screen.queryByText("e2e bypass")).toBeNull();
  });
});
