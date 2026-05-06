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
    // useEditSession 用: editing モードでセッション所有
    getSessionId: vi.fn(() => "test-session"),
    getLock: vi.fn(async () => ({ entry: { ownerSessionId: "test-session" } })),
    acquireLock: vi.fn(async () => undefined),
    releaseLock: vi.fn(async () => undefined),
    createDraft: vi.fn(async () => ({ created: true })),
    updateDraft: vi.fn(async () => undefined),
    commitDraft: vi.fn(async () => ({ committed: true })),
    discardDraft: vi.fn(async () => ({ discarded: true })),
    hasDraft: vi.fn(async () => ({ exists: false })),
    forceReleaseLock: vi.fn(async () => undefined),
  },
}));

const bridgeMock = vi.mocked(mcpBridge);

describe("ExtensionsPanel", () => {
  beforeEach(() => {
    bridgeMock.getExtensions.mockReset();
    bridgeMock.request.mockReset();
    bridgeMock.onExtensionsChanged.mockClear();
    // セッション所有者として editing モードに設定
    (bridgeMock.getLock as ReturnType<typeof vi.fn>).mockResolvedValue({ entry: { ownerSessionId: "test-session" } });
    (bridgeMock.hasDraft as ReturnType<typeof vi.fn>).mockResolvedValue({ exists: false });
    bridgeMock.getExtensions.mockResolvedValue({
      responseTypes: {
        namespace: "",
        responseTypes: {
          ApiError: { description: "API error", schema: { type: "object", properties: {} } },
        },
      },
    });
    bridgeMock.request.mockResolvedValue({ success: true });
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
