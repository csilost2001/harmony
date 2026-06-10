/**
 * AddWorkspaceDialog テスト (#858)
 *
 * - OS-aware placeholder (host info に応じて切り替え)
 * - debounced auto-inspect (入力後 400ms で inspectWorkspace 自動呼び出し)
 * - recent dropdown (focus / 入力時に表示、クリックで補完)
 * - WSL 検出時に専用ヒント表示
 */
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HostInfo, WorkspaceInspectResult } from "../../store/workspaceStore";

// vi.mock factory は hoist されるので、内部で参照する mock は vi.hoisted で持ち上げる
const mocks = vi.hoisted(() => {
  const recentEntries = [
    { id: "ws-1", path: "/home/user/projects/diary", name: "Diary", lastOpenedAt: null },
    { id: "ws-2", path: "/home/user/projects/retail", name: "Retail", lastOpenedAt: null },
  ];
  const baseState = {
    workspaces: recentEntries,
    active: null,
    lockdown: false,
    lockdownPath: null,
    loading: false,
    error: null,
  };
  return {
    inspectWorkspaceMock: vi.fn(),
    getHostInfoMock: vi.fn(),
    openWorkspaceMock: vi.fn(),
    initAndOpenMock: vi.fn(),
    recentEntries,
    baseState,
  };
});

const { inspectWorkspaceMock, getHostInfoMock, openWorkspaceMock, initAndOpenMock } = mocks;

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    onStatusChange: vi.fn(() => () => {}),
    request: vi.fn(),
  },
}));

// BackendFolderPicker は内部で browseFs (mcpBridge.request 経由) を呼ぶ。
// AddWorkspaceDialog のテストでは picker 内部までは検証しないので、軽量モックに差し替える。
vi.mock("./BackendFolderPicker", () => ({
  BackendFolderPicker: ({ onSelect, onClose }: { onSelect: (p: string) => void; onClose: () => void }) => (
    <div data-testid="picker-mock">
      <button data-testid="picker-mock-select" onClick={() => onSelect("/picked/path")}>select</button>
      <button data-testid="picker-mock-close" onClick={onClose}>close</button>
    </div>
  ),
}));

vi.mock("../../store/workspaceStore", async () => {
  const actual = await vi.importActual<typeof import("../../store/workspaceStore")>("../../store/workspaceStore");
  return {
    ...actual,
    getState: vi.fn(() => mocks.baseState),
    subscribe: vi.fn(() => () => {}),
    loadWorkspaces: vi.fn(),
    openWorkspace: mocks.openWorkspaceMock,
    inspectWorkspace: mocks.inspectWorkspaceMock,
    initAndOpen: mocks.initAndOpenMock,
    removeWorkspace: vi.fn(),
    getHostInfo: mocks.getHostInfoMock,
  };
});

import { AddWorkspaceDialog } from "./WorkspaceListView";

describe("AddWorkspaceDialog (#858)", () => {
  beforeEach(() => {
    inspectWorkspaceMock.mockReset();
    getHostInfoMock.mockReset();
    openWorkspaceMock.mockReset();
    initAndOpenMock.mockReset();
    vi.useRealTimers();
  });

  function makeHost(overrides: Partial<HostInfo> = {}): HostInfo {
    return {
      platform: "linux",
      isWSL: false,
      homeDir: "/home/user",
      ...overrides,
    };
  }

  it("placeholder は Harmony 本体 repo 外の project path 例を出す", async () => {
    getHostInfoMock.mockResolvedValue(makeHost());
    inspectWorkspaceMock.mockResolvedValue({ status: "notFound", path: "" } satisfies WorkspaceInspectResult);

    render(<AddWorkspaceDialog onClose={() => {}} onAdded={() => {}} />);

    const input = await screen.findByTestId("workspace-path-input");
    const placeholder = input.getAttribute("placeholder") ?? "";
    expect(placeholder).toContain("/home/user/projects/my-app/harmony-design");
    expect(placeholder).not.toContain("workspaces/my-app");
  });

  it("WSL 環境では Linux 形式の絶対パスを placeholder に出す (#1056 で WSL 専用ヒント文は削除)", async () => {
    // 旧 showDirectoryPicker 経路を BackendFolderPicker (#1056) に置換した結果、
    // WSL2 専用ヒント文 (「Windows ブラウザの『フォルダ参照』では Linux パスに到達不可」)
    // は不要になったので削除した。host info に基づく placeholder 切替は維持。
    getHostInfoMock.mockResolvedValue(makeHost({ platform: "linux", isWSL: true, homeDir: "/home/wsluser" }));
    inspectWorkspaceMock.mockResolvedValue({ status: "notFound", path: "" } satisfies WorkspaceInspectResult);

    render(<AddWorkspaceDialog onClose={() => {}} onAdded={() => {}} />);

    const input = await screen.findByTestId("workspace-path-input");
    await waitFor(() => {
      const placeholder = input.getAttribute("placeholder") ?? "";
      expect(placeholder).toContain("/home/wsluser/projects/my-app/harmony-design");
    });
    // 旧ヒント文が消えていることを negative assert で固定 (#1056 regression 防止)
    expect(screen.queryByText(/WSL2 環境を検出しました/)).toBeNull();
  });

  it("Windows ホストではバックスラッシュ形式の例を出す", async () => {
    getHostInfoMock.mockResolvedValue(makeHost({ platform: "win32", isWSL: false, homeDir: "C:\\Users\\winuser" }));
    inspectWorkspaceMock.mockResolvedValue({ status: "notFound", path: "" } satisfies WorkspaceInspectResult);

    render(<AddWorkspaceDialog onClose={() => {}} onAdded={() => {}} />);

    const input = await screen.findByTestId("workspace-path-input");
    await waitFor(() => {
      const placeholder = input.getAttribute("placeholder") ?? "";
      expect(placeholder).toContain("C:\\Users\\winuser\\projects\\my-app");
    });
  });

  it("入力後 400ms で inspectWorkspace が自動呼び出しされ、status バッジが描画される", async () => {
    getHostInfoMock.mockResolvedValue(makeHost());
    inspectWorkspaceMock.mockResolvedValue({ status: "ready", path: "/home/user/projects/diary", name: "Diary" } satisfies WorkspaceInspectResult);
    vi.useFakeTimers({ shouldAdvanceTime: true });

    render(<AddWorkspaceDialog onClose={() => {}} onAdded={() => {}} />);

    const input = await screen.findByTestId("workspace-path-input");
    fireEvent.change(input, { target: { value: "/home/user/projects/diary" } });

    // debounce 期間中は呼び出されない
    expect(inspectWorkspaceMock).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    await waitFor(() => {
      expect(inspectWorkspaceMock).toHaveBeenCalledWith("/home/user/projects/diary");
    });

    vi.useRealTimers();
    await waitFor(() => {
      const badge = screen.getByTestId("workspace-status");
      expect(badge.getAttribute("data-status")).toBe("ready");
    });
  });

  it("入力欄フォーカスで recent dropdown が出る", async () => {
    getHostInfoMock.mockResolvedValue(makeHost());
    inspectWorkspaceMock.mockResolvedValue({ status: "notFound", path: "" } satisfies WorkspaceInspectResult);

    render(<AddWorkspaceDialog onClose={() => {}} onAdded={() => {}} />);

    const input = await screen.findByTestId("workspace-path-input");
    fireEvent.focus(input);

    expect(screen.getByRole("listbox", { name: "最近使ったワークスペース" })).toBeTruthy();
    expect(screen.getByText("Diary")).toBeTruthy();
    expect(screen.getByText("Retail")).toBeTruthy();
  });

  it("recent dropdown のエントリをクリックすると入力欄に絶対パスが入る", async () => {
    getHostInfoMock.mockResolvedValue(makeHost());
    inspectWorkspaceMock.mockResolvedValue({ status: "ready", path: "/home/user/projects/diary", name: "Diary" } satisfies WorkspaceInspectResult);

    render(<AddWorkspaceDialog onClose={() => {}} onAdded={() => {}} />);

    const input = (await screen.findByTestId("workspace-path-input")) as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.click(screen.getByText("Diary"));

    expect(input.value).toBe("/home/user/projects/diary");
  });

  it("入力中の文字列で recent エントリを substring-match で絞り込む", async () => {
    getHostInfoMock.mockResolvedValue(makeHost());
    inspectWorkspaceMock.mockResolvedValue({ status: "notFound", path: "" } satisfies WorkspaceInspectResult);

    render(<AddWorkspaceDialog onClose={() => {}} onAdded={() => {}} />);

    const input = await screen.findByTestId("workspace-path-input");
    fireEvent.change(input, { target: { value: "diary" } });

    // dropdown は表示状態のまま (focus + 入力)
    expect(screen.getByText("Diary")).toBeTruthy();
    // Retail はマッチしないので非表示
    expect(screen.queryByText("Retail")).toBeNull();
  });

  it("Escape キーで recent dropdown が閉じる (input focus は維持) (SF-3)", async () => {
    getHostInfoMock.mockResolvedValue(makeHost());
    inspectWorkspaceMock.mockResolvedValue({ status: "notFound", path: "" } satisfies WorkspaceInspectResult);

    render(<AddWorkspaceDialog onClose={() => {}} onAdded={() => {}} />);

    const input = await screen.findByTestId("workspace-path-input");
    fireEvent.focus(input);
    expect(screen.queryByRole("listbox", { name: "最近使ったワークスペース" })).toBeTruthy();

    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("listbox", { name: "最近使ったワークスペース" })).toBeNull();
    });
  });

  it("Tab キーで recent dropdown が閉じる (SF-3)", async () => {
    getHostInfoMock.mockResolvedValue(makeHost());
    inspectWorkspaceMock.mockResolvedValue({ status: "notFound", path: "" } satisfies WorkspaceInspectResult);

    render(<AddWorkspaceDialog onClose={() => {}} onAdded={() => {}} />);

    const input = await screen.findByTestId("workspace-path-input");
    fireEvent.focus(input);
    expect(screen.queryByRole("listbox", { name: "最近使ったワークスペース" })).toBeTruthy();

    fireEvent.keyDown(input, { key: "Tab" });

    await waitFor(() => {
      expect(screen.queryByRole("listbox", { name: "最近使ったワークスペース" })).toBeNull();
    });
  });

  it("「参照」ボタンで BackendFolderPicker を開き、選択結果が入力欄に反映される (#1056)", async () => {
    getHostInfoMock.mockResolvedValue(makeHost());
    inspectWorkspaceMock.mockResolvedValue({ status: "ready", path: "/picked/path", name: "Picked" } satisfies WorkspaceInspectResult);

    render(<AddWorkspaceDialog onClose={() => {}} onAdded={() => {}} />);

    // 初期状態では picker は閉じている
    expect(screen.queryByTestId("picker-mock")).toBeNull();

    // 「参照」ボタンクリックで picker を開く
    const browseBtn = await screen.findByTestId("open-folder-picker");
    fireEvent.click(browseBtn);

    expect(screen.getByTestId("picker-mock")).toBeTruthy();

    // picker 内 select クリックで入力欄が埋まり picker は閉じる
    fireEvent.click(screen.getByTestId("picker-mock-select"));

    await waitFor(() => {
      expect(screen.queryByTestId("picker-mock")).toBeNull();
    });
    const input = screen.getByTestId("workspace-path-input") as HTMLInputElement;
    expect(input.value).toBe("/picked/path");
  });

  it("入力を空に戻すと進行中 inspect の遅延結果で UI が上書きされない (MF-1 race fix)", async () => {
    getHostInfoMock.mockResolvedValue(makeHost());
    // 1 回目の inspect は遅延して resolve するよう細工
    let resolveFirst: (v: WorkspaceInspectResult) => void = () => {};
    const firstPromise = new Promise<WorkspaceInspectResult>((res) => { resolveFirst = res; });
    inspectWorkspaceMock.mockReturnValueOnce(firstPromise);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<AddWorkspaceDialog onClose={() => {}} onAdded={() => {}} />);
    const input = await screen.findByTestId("workspace-path-input");

    // パスを入力 → debounce 完了 → inspectWorkspace が呼ばれて pending 状態
    fireEvent.change(input, { target: { value: "/home/user/projects/diary" } });
    await act(async () => { vi.advanceTimersByTime(400); });
    await waitFor(() => {
      expect(inspectWorkspaceMock).toHaveBeenCalledWith("/home/user/projects/diary");
    });

    // この時点で status="inspecting" バッジが描画されているはず
    expect(screen.getByTestId("workspace-status").getAttribute("data-status")).toBe("inspecting");

    // パスを空に戻す → 進行中の inspect は seq guard で破棄されるべき
    fireEvent.change(input, { target: { value: "" } });
    // 空入力で status badge は消える (idle)
    await waitFor(() => {
      expect(screen.queryByTestId("workspace-status")).toBeNull();
    });

    // 遅延していた 1 回目の inspect が後から resolve しても、
    // status badge は再描画されない (seq guard で結果が破棄される)
    resolveFirst({ status: "ready", path: "/home/user/projects/diary", name: "Diary" });
    vi.useRealTimers();

    // 100ms 待っても status badge は出ない
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("workspace-status")).toBeNull();
  });
});
