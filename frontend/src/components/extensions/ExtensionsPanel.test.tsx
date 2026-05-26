import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExtensionsPanel } from "./ExtensionsPanel";
import { mcpBridge } from "../../mcp/mcpBridge";

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    getExtensions: vi.fn(),
    request: vi.fn(),
    onExtensionsChanged: vi.fn(() => () => undefined),
    onBroadcast: vi.fn(() => () => undefined),
    // Phase 6 (#903): useEditSession (新 API) 用
    getSessionId: vi.fn(() => "test-session"),
    hasDraft: vi.fn(async () => ({ exists: false })),
  },
}));

const bridgeMock = vi.mocked(mcpBridge);

const MOCK_EDIT_SESSION = {
  id: "es-ext-001",
  resourceType: "extension",
  resourceId: "default",
  state: "Active",
  participants: { "test-session": { sessionId: "test-session", role: "Edit", joinedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(), displayLabel: "@test" } },
  payload: null,
  sequence: 1,
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  saveHistory: [],
  lastActivityAt: new Date().toISOString(),
};

describe("ExtensionsPanel", () => {
  beforeEach(() => {
    bridgeMock.getExtensions.mockReset();
    bridgeMock.request.mockReset();
    bridgeMock.onExtensionsChanged.mockClear();
    ((bridgeMock as unknown as { hasDraft: ReturnType<typeof vi.fn> }).hasDraft).mockResolvedValue({ exists: false });
    bridgeMock.getExtensions.mockResolvedValue({
      responseTypes: {
        namespace: "",
        responseTypes: {
          ApiError: { description: "API error", schema: { type: "object", properties: {} } },
        },
      },
    });
    // Phase 6 (#903): editSession.create で editing モードに入る
    (bridgeMock.request as ReturnType<typeof vi.fn>).mockImplementation(async (method: string) => {
      if (method === "editSession.create") return { editSession: MOCK_EDIT_SESSION };
      if (method === "editSession.save") return { saveEvent: { savedBy: "test-session", savedAt: new Date().toISOString(), sequence: 1 } };
      if (method === "editSession.list") return { sessions: [MOCK_EDIT_SESSION] };
      return { success: true };
    });
  });

  it("renders five extension tabs", async () => {
    render(<MemoryRouter><ExtensionsPanel /></MemoryRouter>);
    expect(await screen.findByRole("tab", { name: /ステップ型/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /フィールド型/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /トリガー/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /DB 操作/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /レスポンス型/ })).toBeInTheDocument();
  });

  it("saves response type changes through wsBridge", async () => {
    render(<MemoryRouter initialEntries={["/extensions?tab=responseTypes"]}><ExtensionsPanel /></MemoryRouter>);

    expect(await screen.findByDisplayValue("ApiError")).toBeInTheDocument();

    // Phase 6 (#903): 新 API では readonly から編集開始ボタンを押して editing モードに入る
    const startButton = screen.queryByRole("button", { name: "編集開始" });
    if (startButton) {
      fireEvent.click(startButton);
      await screen.findByRole("button", { name: "追加" });
    }

    fireEvent.click(screen.getByRole("button", { name: "追加" }));
    fireEvent.change(screen.getAllByPlaceholderText("ApiError")[1], { target: { value: "Created" } });
    // EditModeToolbar の「保存」と tab の「保存」があるため getAllByRole で後者を選ぶ
    const saveButtons = screen.getAllByRole("button", { name: "保存" });
    fireEvent.click(saveButtons[saveButtons.length - 1]);

    await waitFor(() => {
      expect(bridgeMock.request).toHaveBeenCalledWith(
        "saveExtensionPackage",
        expect.objectContaining({ type: "responseTypes" }),
      );
    });
  });
});
