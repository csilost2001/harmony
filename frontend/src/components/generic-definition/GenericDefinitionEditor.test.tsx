import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GenericDefinitionEditor } from "./GenericDefinitionEditor";

const saveGenericDefinition = vi.fn();
let broadcastHandler: ((data: unknown) => void) | null = null;

vi.mock("../../hooks/useWorkspacePath", () => ({
  useWorkspacePath: () => ({ wsPath: (path: string) => path }),
}));

vi.mock("../../store/tabStore", () => ({
  makeTabId: vi.fn(() => "tab-id"),
  openTab: vi.fn(),
}));

vi.mock("../../store/genericDefinitionStore", () => ({
  loadGenericDefinition: vi.fn(async () => ({
    kind: "data-contract",
    name: "Order",
    purpose: "initial purpose",
    responsibilities: ["responsibility"],
    targets: ["backend"],
    fields: [],
    operations: [],
    relations: [],
    constraints: [],
  })),
  saveGenericDefinition: (...args: unknown[]) => saveGenericDefinition(...args),
  deleteGenericDefinition: vi.fn(),
}));

vi.mock("../../schemas/genericDefinitionValidator", () => ({
  validateGenericDefinition: vi.fn(() => []),
}));

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    onBroadcast: vi.fn((_event: string, handler: (data: unknown) => void) => {
      broadcastHandler = handler;
      return () => undefined;
    }),
    // #1331: useEditSession 依存 — test では EditSession 連携は no-op で良い
    getSessionId: vi.fn(() => "test-session"),
    request: vi.fn(async () => ({})),
    onStatusChange: vi.fn(() => () => undefined),
    getStatus: vi.fn(() => "connected"),
    startWithoutEditor: vi.fn(),
  },
}));

beforeEach(() => {
  saveGenericDefinition.mockReset();
  broadcastHandler = null;
});

describe("GenericDefinitionEditor — Phase K stale save prevention", () => {
  it("dirty 編集中に rename reload を受信したら再読込まで保存を block する", async () => {
    render(
      <MemoryRouter initialEntries={["/generic-definition/data-contract/Order"]}>
        <Routes>
          <Route path="/generic-definition/:kind/:name" element={<GenericDefinitionEditor />} />
        </Routes>
      </MemoryRouter>,
    );

    const purpose = await screen.findByDisplayValue("initial purpose");
    fireEvent.change(purpose, { target: { value: "dirty purpose" } });
    expect(broadcastHandler).not.toBeNull();
    act(() => broadcastHandler?.({ reload: true }));

    const save = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    await waitFor(() => expect(screen.getByTestId("generic-definition-reload-banner")).toBeTruthy());
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(saveGenericDefinition).not.toHaveBeenCalled();
  });
});
