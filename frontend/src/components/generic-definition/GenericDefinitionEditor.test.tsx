import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GenericDefinitionEditor } from "./GenericDefinitionEditor";

const saveGenericDefinition = vi.fn();
let broadcastHandler: ((data: unknown) => void) | null = null;

/**
 * #1368: mcpBridge.request の per-method スタブ。各 test で挙動を上書き可能。
 * - editSession.create: { editSession: { id: "test-es-1" } }
 * - editSession.update: { sequence: 1 }
 * - editSession.save: デフォルト { ok: true } / conflict 時は { ok: false, conflict: {...} }
 * - editSession.discard: { discarded: true }
 */
const mcpRequest = vi.fn(async (method: string, _params?: unknown) => {
  switch (method) {
    case "editSession.create":
      return { editSession: { id: "test-es-1" } };
    case "editSession.update":
      return { sequence: 1 };
    case "editSession.save":
      return { ok: true };
    case "editSession.discard":
      return { discarded: true };
    default:
      return {};
  }
});

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
    request: (method: string, params?: unknown) => mcpRequest(method, params),
    onStatusChange: vi.fn(() => () => undefined),
    getStatus: vi.fn(() => "connected"),
    startWithoutEditor: vi.fn(),
  },
}));

beforeEach(() => {
  saveGenericDefinition.mockReset();
  mcpRequest.mockClear();
  broadcastHandler = null;
});

/**
 * helper: editor を render して initial purpose input が出るまで待つ。
 */
async function renderEditor() {
  const result = render(
    <MemoryRouter initialEntries={["/generic-definition/data-contract/Order"]}>
      <Routes>
        <Route path="/generic-definition/:kind/:name" element={<GenericDefinitionEditor />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByDisplayValue("initial purpose");
  return result;
}

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

describe("GenericDefinitionEditor — #1368 editSession.save 経路統合", () => {
  it("save click は editSession.update + editSession.save 経由で commit する (saveGenericDefinition 直呼びはしない)", async () => {
    await renderEditor();

    // 編集して dirty 状態にしてから save
    const purpose = screen.getByDisplayValue("initial purpose");
    fireEvent.change(purpose, { target: { value: "edited purpose" } });

    const save = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    fireEvent.click(save);

    // editSession.create → editSession.update → editSession.save の順で呼ばれる
    await waitFor(() => {
      const calls = mcpRequest.mock.calls.map((c) => c[0] as string);
      expect(calls).toContain("editSession.update");
      expect(calls).toContain("editSession.save");
    });

    // editSession.save の params に force: true が無い (通常 save path)
    const saveCalls = mcpRequest.mock.calls.filter((c) => c[0] === "editSession.save");
    expect(saveCalls.length).toBeGreaterThanOrEqual(1);
    const saveParams = saveCalls[0][1] as { force?: boolean } | undefined;
    expect(saveParams?.force).toBeUndefined();

    // saveGenericDefinition 直呼び path は使われていない (#1368 で editSession.save に統合)
    expect(saveGenericDefinition).not.toHaveBeenCalled();
  });

  it("editSession.save が { ok: false, conflict: { other } } を返したら SaveConflictDialog を表示する", async () => {
    // editSession.save を conflict response に切替
    mcpRequest.mockImplementation(async (method: string) => {
      switch (method) {
        case "editSession.create":
          return { editSession: { id: "test-es-conflict" } };
        case "editSession.update":
          return { sequence: 1 };
        case "editSession.save":
          return {
            ok: false,
            conflict: {
              other: {
                editSessionId: "other-es-1",
                savedBy: "alice@session-xyz",
                savedAt: "2026-05-27T12:00:00.000Z",
                displayLabel: "Alice",
              },
            },
          };
        default:
          return {};
      }
    });

    await renderEditor();

    const purpose = screen.getByDisplayValue("initial purpose");
    fireEvent.change(purpose, { target: { value: "edited" } });

    const save = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    fireEvent.click(save);

    // SaveConflictDialog の上書き button が表示される
    await waitFor(() => {
      expect(screen.getByTestId("overwrite-confirm-btn")).toBeTruthy();
    });
    // 衝突相手 displayLabel が dialog 内に表示される
    expect(screen.getByText(/Alice/)).toBeTruthy();
  });

  it("SaveConflictDialog で上書きを click すると editSession.save に force: true で再呼出する", async () => {
    // 1 回目 save は conflict、2 回目 (overwrite) は ok=true
    let saveCount = 0;
    mcpRequest.mockImplementation(async (method: string) => {
      switch (method) {
        case "editSession.create":
          return { editSession: { id: "test-es-overwrite" } };
        case "editSession.update":
          return { sequence: 1 };
        case "editSession.save":
          saveCount += 1;
          if (saveCount === 1) {
            return {
              ok: false,
              conflict: {
                other: {
                  editSessionId: "other-es-2",
                  savedBy: "bob",
                  savedAt: "2026-05-27T12:00:00.000Z",
                  displayLabel: "Bob",
                },
              },
            };
          }
          return { ok: true };
        case "editSession.discard":
          return { discarded: true };
        default:
          return {};
      }
    });

    await renderEditor();

    const purpose = screen.getByDisplayValue("initial purpose");
    fireEvent.change(purpose, { target: { value: "overwrite test" } });

    const save = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    fireEvent.click(save);

    // dialog 表示まで待つ
    const overwriteBtn = await waitFor(() => screen.getByTestId("overwrite-confirm-btn"));
    fireEvent.click(overwriteBtn);

    // 2 回目の editSession.save が force: true で呼ばれる
    await waitFor(() => {
      const saveCalls = mcpRequest.mock.calls.filter((c) => c[0] === "editSession.save");
      expect(saveCalls.length).toBeGreaterThanOrEqual(2);
      const second = saveCalls[1][1] as { force?: boolean };
      expect(second.force).toBe(true);
    });
  });

  it("handleSaveOverwrite は reloadBanner 中なら force save を block する (Codex Round 1 Should-fix)", async () => {
    // 1 回目 save は conflict、reloadBanner 立てた後に overwrite click → block
    mcpRequest.mockImplementation(async (method: string) => {
      switch (method) {
        case "editSession.create":
          return { editSession: { id: "test-es-overwrite-block" } };
        case "editSession.update":
          return { sequence: 1 };
        case "editSession.save":
          return {
            ok: false,
            conflict: {
              other: {
                editSessionId: "other-es-3",
                savedBy: "carol",
                savedAt: "2026-05-27T12:00:00.000Z",
                displayLabel: "Carol",
              },
            },
          };
        default:
          return {};
      }
    });

    await renderEditor();

    const purpose = screen.getByDisplayValue("initial purpose");
    fireEvent.change(purpose, { target: { value: "overwrite block test" } });

    const save = screen.getByRole("button", { name: "保存" }) as HTMLButtonElement;
    fireEvent.click(save);

    // conflict dialog 表示まで待つ
    const overwriteBtn = await waitFor(() => screen.getByTestId("overwrite-confirm-btn"));

    // dialog 表示中に rename/undo 由来の reload broadcast を受信させる
    expect(broadcastHandler).not.toBeNull();
    act(() => broadcastHandler?.({ reload: true }));
    await waitFor(() => expect(screen.getByTestId("generic-definition-reload-banner")).toBeTruthy());

    // 上書き click → block (force: true で editSession.save が呼ばれない)
    const saveCallsBefore = mcpRequest.mock.calls.filter((c) => c[0] === "editSession.save").length;
    fireEvent.click(overwriteBtn);

    // しばらく待っても editSession.save の force: true 呼出は増えない
    await new Promise((resolve) => setTimeout(resolve, 50));
    const saveCallsAfter = mcpRequest.mock.calls.filter((c) => c[0] === "editSession.save");
    expect(saveCallsAfter.length).toBe(saveCallsBefore); // 増えない
    expect(saveCallsAfter.every((c) => !(c[1] as { force?: boolean })?.force)).toBe(true);
  });
});
