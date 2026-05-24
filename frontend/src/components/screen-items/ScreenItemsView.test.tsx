/**
 * ScreenItemsView 統合 component test (#1304 scaffold + #1314 interaction)
 *
 * ScreenItemsView.tsx (約 1900 行、events panel / items table / fragments panel /
 * lintIssues 等) の統合 render baseline と編集動作を担保する。
 *
 * mock 戦略:
 *   - 末端モジュール (mcpBridge / store 群 / schema) を vi.mock で固定
 *   - React hooks (useResourceEditor / useEditSession 等) は実 hook を使い、
 *     mcpBridge / store 経由の I/O をモック値で吸収する
 *     (hooks を mock すると実 hook の依存 import が二重変換されて OOM になるため)
 *   - 重い子コンポーネント (SaveConflictDialog / ResumeOrDiscardDialog 等) は no-op mock
 *
 * Step 1: scaffold render baseline (6 test)
 * Step 2: 編集動作 interaction (12 test) — #1314
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";

// ---------------------------------------------------------------------------
// mcpBridge mock (最重要: html2canvas / grapesjs の重い import を遮断)
// ---------------------------------------------------------------------------
vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    on: vi.fn(),
    off: vi.fn(),
    send: vi.fn(),
    isConnected: () => false,
    getSessionId: () => "test-session-id",
    startWithoutEditor: vi.fn(),
    onStatusChange: vi.fn().mockReturnValue(() => {}),
    onBroadcast: vi.fn().mockReturnValue(() => {}),
    // デフォルト: editSession.list → empty (active session なし) / それ以外 → null
    request: vi.fn().mockImplementation((method: string) => {
      if (method === "editSession.list") {
        return Promise.resolve({ sessions: [] });
      }
      if (method === "editSession.create") {
        return Promise.resolve({
          editSession: {
            id: "mock-session-id",
            resourceType: "screen-item",
            resourceId: "test-screen-id",
            state: "Active",
            participants: { "test-session-id": { role: "Edit" } },
            sequence: 0,
            payload: null,
          },
        });
      }
      return Promise.resolve(null);
    }),
    getExtensions: vi.fn().mockResolvedValue({}),
    onExtensionsChanged: vi.fn().mockReturnValue(() => {}),
  },
}));

// ---------------------------------------------------------------------------
// store mocks (backend I/O を遮断)
// ---------------------------------------------------------------------------
vi.mock("../../store/flowStore", () => ({
  // test-screen-id を screens に含める (存在しない場合に navigate("/screen/list") が呼ばれてアンマウントするため)
  loadProject: vi.fn().mockResolvedValue({
    screens: [{ id: "test-screen-id", name: "テスト画面" }],
  }),
}));

vi.mock("../../store/conventionsStore", () => ({
  loadConventions: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../store/processFlowStore", () => ({
  listProcessFlows: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../store/tableStore", () => ({
  listTables: vi.fn().mockResolvedValue([]),
  loadTable: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../store/viewStore", () => ({
  listViews: vi.fn().mockResolvedValue([]),
  loadView: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../store/genericDefinitionStore", () => ({
  listGenericDefinitions: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../store/screenItemsStore", () => ({
  loadScreenItems: vi.fn().mockResolvedValue({
    screenId: "test-screen-id",
    updatedAt: "2026-01-01T00:00:00Z",
    items: [],
  }),
  saveScreenItems: vi.fn().mockResolvedValue(undefined),
  createEmptyScreenItems: vi.fn().mockReturnValue({
    screenId: "test-screen-id",
    updatedAt: "2026-01-01T00:00:00Z",
    items: [],
  }),
}));

// items 1 件 fixture (S-3 用: events toggle / fragments panel の render 条件を満たす)
const FIXTURE_SCREEN_ITEMS_ONE_ITEM = {
  screenId: "test-screen-id",
  updatedAt: "2026-01-01T00:00:00Z",
  items: [
    { id: "customerId", label: "顧客ID", type: "string" as const },
  ],
};

// ---------------------------------------------------------------------------
// schema / validator mocks (重い処理回避)
// ---------------------------------------------------------------------------
vi.mock("../../schemas/loadExtensions", () => ({
  loadExtensionsFromBundle: vi.fn().mockReturnValue({ extensions: {} }),
}));

vi.mock("../../schemas/conventionsValidator", () => ({
  checkScreenItemConventionReferences: vi.fn().mockReturnValue([]),
}));

// ---------------------------------------------------------------------------
// 重い子 component mocks (modal 系は DOM に出てこない方が test 軽い)
// ---------------------------------------------------------------------------
vi.mock("../editing/SaveConflictDialog", () => ({
  SaveConflictDialog: () => null,
}));
vi.mock("../editing/ResumeOrDiscardDialog", () => ({
  ResumeOrDiscardDialog: () => null,
}));
vi.mock("./ScreenItemCandidatesModal", () => ({
  ScreenItemCandidatesModal: () => null,
}));

// ---------------------------------------------------------------------------
// SUT import (vi.mock() hoisting 後)
// ---------------------------------------------------------------------------
import { ScreenItemsView } from "./ScreenItemsView";
import { mcpBridge } from "../../mcp/mcpBridge";

// ---------------------------------------------------------------------------
// render helper
// ---------------------------------------------------------------------------
function renderWithRouter(screenId = "test-screen-id") {
  return render(
    <MemoryRouter initialEntries={[`/screen/items/${screenId}`]}>
      <Routes>
        <Route path="/screen/items/:screenId" element={<ScreenItemsView />} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Step 2 fixtures
// ---------------------------------------------------------------------------

/** argumentMapping 1 件付きイベントを持つ item */
const FIXTURE_WITH_EVENT_ARGMAP = {
  screenId: "test-screen-id",
  updatedAt: "2026-01-01T00:00:00Z",
  items: [
    {
      id: "customerId",
      label: "顧客ID",
      type: "string" as const,
      events: [
        {
          id: "ev-1",
          handlerFlowId: "flow-1",
          argumentMapping: { orderId: "@var.action.id" },
        },
      ],
    },
  ],
};

/** effects[] 1 件 (setReadonly, value:boolean) 付きイベントを持つ item */
const FIXTURE_WITH_EVENT_EFFECT_BOOL = {
  screenId: "test-screen-id",
  updatedAt: "2026-01-01T00:00:00Z",
  items: [
    {
      id: "customerId",
      label: "顧客ID",
      type: "string" as const,
      events: [
        {
          id: "ev-1",
          handlerFlowId: "flow-1",
          effects: [{ kind: "setReadonly" as const, target: "customerId", value: true }],
        },
      ],
    },
  ],
};

/** effects[] 1 件 (setReadonly, value:string 式) 付きイベントを持つ item */
const FIXTURE_WITH_EVENT_EFFECT_EXPR = {
  screenId: "test-screen-id",
  updatedAt: "2026-01-01T00:00:00Z",
  items: [
    {
      id: "customerId",
      label: "顧客ID",
      type: "string" as const,
      events: [
        {
          id: "ev-1",
          handlerFlowId: "flow-1",
          effects: [{ kind: "setReadonly" as const, target: "customerId", value: "@var.foo" }],
        },
      ],
    },
  ],
};

/** items 2 件 */
const FIXTURE_WITH_TWO_ITEMS = {
  screenId: "test-screen-id",
  updatedAt: "2026-01-01T00:00:00Z",
  items: [
    { id: "customerId", label: "顧客ID", type: "string" as const },
    { id: "productId", label: "商品ID", type: "string" as const },
  ],
};

// ---------------------------------------------------------------------------
// helper: 「編集開始」ボタンをクリックして editing モードに切り替える
//   (mode.kind === "editing" になると isReadonly=false → updateWithDraft が有効化)
// ---------------------------------------------------------------------------
async function startEditingMode(container: HTMLElement): Promise<void> {
  // 「編集開始」ボタンが出るまで待つ (mode=readonly の時に表示される)
  // data-testid="edit-mode-start" を使うと確実
  await waitFor(() => {
    const btn = container.querySelector<HTMLButtonElement>('[data-testid="edit-mode-start"]');
    expect(btn).not.toBeNull();
  }, { timeout: 3000 });
  const startBtn = container.querySelector<HTMLButtonElement>('[data-testid="edit-mode-start"]')!;
  await act(async () => {
    fireEvent.click(startBtn);
  });
  // edit mode になるまで待つ (「保存」ボタン data-testid="edit-mode-save" が出る)
  await waitFor(() => {
    const saveBtn = container.querySelector<HTMLButtonElement>('[data-testid="edit-mode-save"]');
    expect(saveBtn).not.toBeNull();
  }, { timeout: 3000 });
}

// ---------------------------------------------------------------------------
// helper: イベント展開パネルを開く (expandedEventRows.has(i) が true になるまで待機)
// ---------------------------------------------------------------------------
async function expandEventPanel(container: HTMLElement): Promise<void> {
  await waitFor(() => {
    const btn = container.querySelector('[aria-label="イベント展開"]');
    expect(btn).not.toBeNull();
  }, { timeout: 3000 });
  const btn = container.querySelector('[aria-label="イベント展開"]') as HTMLButtonElement;
  await act(async () => {
    fireEvent.click(btn);
  });
  // イベントパネルが展開されるまで待つ (screen-items-event-card が出現)
  await waitFor(() => {
    const card = container.querySelector(".screen-items-event-card");
    expect(card).not.toBeNull();
  }, { timeout: 3000 });
}

// ---------------------------------------------------------------------------
// tests (Step 1: scaffold render baseline)
// ---------------------------------------------------------------------------
describe("ScreenItemsView (統合 scaffold)", () => {
  it("1. 基本 render が成功する (例外なく描画)", () => {
    const { container } = renderWithRouter();
    expect(container.firstChild).not.toBeNull();
  });

  it("2. screen-items-view container が存在する", () => {
    const { container } = renderWithRouter();
    // ScreenItemsView のルート div は className "screen-items-view" を持つ
    const view = container.querySelector(".screen-items-view");
    expect(view).not.toBeNull();
  });

  it("3. items 0 件で items table 領域が render される (非同期ロード後)", async () => {
    const { container } = renderWithRouter();
    // items table は file ロード完了後に <table> 要素として描画される
    await waitFor(() => {
      const table = container.querySelector("table");
      expect(table).not.toBeNull();
    }, { timeout: 3000 });
  });

  it("4. items 1 件状態でイベント展開ボタン (toggle) が render される", async () => {
    // S-3: events panel の toggle button は items 行が存在する場合のみ render される
    // loadScreenItems を items 1 件返す fixture に差し替える
    const { loadScreenItems } = await import("../../store/screenItemsStore");
    vi.mocked(loadScreenItems).mockResolvedValueOnce(FIXTURE_SCREEN_ITEMS_ONE_ITEM);

    const { container } = renderWithRouter();
    // 非同期ロード完了後に items 行が描画される
    await waitFor(() => {
      // イベント展開ボタンは aria-label="イベント展開" で識別可能
      const eventToggleBtn = container.querySelector('[aria-label="イベント展開"]');
      expect(eventToggleBtn).not.toBeNull();
    }, { timeout: 3000 });
  });

  it("5. fragments panel が常に render される (.fragments-panel className 確認)", async () => {
    const { container } = renderWithRouter();
    // S-3: FragmentsPanel は items 数に関わらず常時 render (collapsible toggle UI)
    // .fragments-panel className は FragmentsPanel のルート div で必ず付与される
    await waitFor(() => {
      const fragmentsPanel = container.querySelector(".fragments-panel");
      expect(fragmentsPanel).not.toBeNull();
    }, { timeout: 3000 });
  });

  it("6. screen-items-toolbar と「項目追加」ボタンが render される", async () => {
    const { container } = renderWithRouter();
    // S-1: items 0 件でもツールバーは必ず render される
    // screen-items-toolbar div の存在と、その中の「項目追加」ボタンを具体的に確認
    await waitFor(() => {
      const toolbar = container.querySelector(".screen-items-toolbar");
      expect(toolbar).not.toBeNull();
      // 「項目追加」ボタン (.screen-items-add) が 1 つ以上存在すること
      const addButtons = container.querySelectorAll(".screen-items-add");
      expect(addButtons.length).toBeGreaterThan(0);
    }, { timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// tests (Step 2: 編集動作 interaction — #1314)
// ---------------------------------------------------------------------------
describe("ScreenItemsView (Step 2: 編集動作)", () => {
  // Step 2 全体で editing mode の mock を有効にする
  // (mcpBridge.request が editSession.create に EditSession オブジェクトを返す)
  beforeEach(() => {
    vi.mocked(mcpBridge.request).mockImplementation((method: string) => {
      if (method === "editSession.list") {
        return Promise.resolve({ sessions: [] });
      }
      if (method === "editSession.create") {
        return Promise.resolve({
          editSession: {
            id: "mock-session-id",
            resourceType: "screen-item",
            resourceId: "test-screen-id",
            state: "Active",
            participants: { "test-session-id": { role: "Edit" } },
            sequence: 0,
            payload: null,
          },
        });
      }
      return Promise.resolve(null);
    });
  });

  // -------------------------------------------------------------------------
  describe("argumentMapping CRUD (#1288 連動)", () => {
    it("7. 「+追加」ボタンで argumentMapping 行が +1 (1件 → 2件)", async () => {
      const { loadScreenItems } = await import("../../store/screenItemsStore");
      vi.mocked(loadScreenItems).mockResolvedValueOnce(FIXTURE_WITH_EVENT_ARGMAP);

      const { container } = renderWithRouter();
      await startEditingMode(container);
      await expandEventPanel(container);

      // 初期状態: 既存 1 件の key input がある
      await waitFor(() => {
        const keyInputs = Array.from(container.querySelectorAll<HTMLInputElement>(
          ".screen-items-event-mapping-row input[placeholder='action 引数名 (Identifier)']"
        ));
        expect(keyInputs.length).toBe(1);
      }, { timeout: 3000 });

      // 「+追加」ボタン (title="マッピング行を追加") をクリック
      const addArgBtn = Array.from(container.querySelectorAll("button")).find(
        (btn) => btn.title === "マッピング行を追加"
      );
      expect(addArgBtn).not.toBeUndefined();
      await act(async () => {
        fireEvent.click(addArgBtn!);
      });

      // key input が 2 件になること
      await waitFor(() => {
        const keyInputs = container.querySelectorAll(
          ".screen-items-event-mapping-row input[placeholder='action 引数名 (Identifier)']"
        );
        expect(keyInputs.length).toBe(2);
      }, { timeout: 3000 });
    });

    it("8. key 入力欄の変更が DOM に反映される", async () => {
      const { loadScreenItems } = await import("../../store/screenItemsStore");
      vi.mocked(loadScreenItems).mockResolvedValueOnce(FIXTURE_WITH_EVENT_ARGMAP);

      const { container } = renderWithRouter();
      await startEditingMode(container);
      await expandEventPanel(container);

      // key="orderId" の input を取得
      await waitFor(() => {
        const keyInput = container.querySelector<HTMLInputElement>(
          ".screen-items-event-mapping-row input[placeholder='action 引数名 (Identifier)']"
        );
        expect(keyInput).not.toBeNull();
        expect(keyInput!.value).toBe("orderId");
      }, { timeout: 3000 });

      const keyInput = container.querySelector<HTMLInputElement>(
        ".screen-items-event-mapping-row input[placeholder='action 引数名 (Identifier)']"
      )!;

      await act(async () => {
        fireEvent.change(keyInput, { target: { value: "productId" } });
      });

      await waitFor(() => {
        // DOM 上で値が更新されていること
        const updated = container.querySelector<HTMLInputElement>(
          ".screen-items-event-mapping-row input[placeholder='action 引数名 (Identifier)']"
        );
        expect(updated!.value).toBe("productId");
      }, { timeout: 3000 });
    });

    it("9. 削除ボタンで argumentMapping 行が -1 (1件 → 0件)", async () => {
      const { loadScreenItems } = await import("../../store/screenItemsStore");
      vi.mocked(loadScreenItems).mockResolvedValueOnce(FIXTURE_WITH_EVENT_ARGMAP);

      const { container } = renderWithRouter();
      await startEditingMode(container);
      await expandEventPanel(container);

      // 初期 1 件の key input 確認
      await waitFor(() => {
        const keyInputs = container.querySelectorAll(
          ".screen-items-event-mapping-row input[placeholder='action 引数名 (Identifier)']"
        );
        expect(keyInputs.length).toBe(1);
      }, { timeout: 3000 });

      // 削除ボタン (title="マッピング行を削除")
      const delBtn = Array.from(container.querySelectorAll("button")).find(
        (btn) => btn.title === "マッピング行を削除"
      );
      expect(delBtn).not.toBeUndefined();
      await act(async () => {
        fireEvent.click(delBtn!);
      });

      // key input が 0 件 (空 placeholder テキストが消える)
      await waitFor(() => {
        const keyInputs = container.querySelectorAll(
          ".screen-items-event-mapping-row input[placeholder='action 引数名 (Identifier)']"
        );
        expect(keyInputs.length).toBe(0);
      }, { timeout: 3000 });
    });
  });

  // -------------------------------------------------------------------------
  describe("effects[] CRUD (#1287 連動)", () => {
    it("10. 「効果追加」ボタンで effect が +1 (0件 → 1件)", async () => {
      const { loadScreenItems } = await import("../../store/screenItemsStore");
      // argumentMapping のみのfixture (effects なし)
      vi.mocked(loadScreenItems).mockResolvedValueOnce({
        ...FIXTURE_WITH_EVENT_ARGMAP,
        items: [
          { ...FIXTURE_WITH_EVENT_ARGMAP.items[0], events: [{ id: "ev-1", handlerFlowId: "flow-1" }] },
        ],
      });

      const { container } = renderWithRouter();
      await startEditingMode(container);
      await expandEventPanel(container);

      // 初期 0 件
      await waitFor(() => {
        const effectRows = container.querySelectorAll(".screen-items-event-effect-row");
        expect(effectRows.length).toBe(0);
      }, { timeout: 3000 });

      // 「効果追加」ボタン (title="効果を追加")
      const addEffectBtn = Array.from(container.querySelectorAll("button")).find(
        (btn) => btn.title === "効果を追加"
      );
      expect(addEffectBtn).not.toBeUndefined();
      await act(async () => {
        fireEvent.click(addEffectBtn!);
      });

      await waitFor(() => {
        const effectRows = container.querySelectorAll(".screen-items-event-effect-row");
        expect(effectRows.length).toBe(1);
      }, { timeout: 3000 });
    });

    it("11. kind selector を setReadonly → setOptions に変更すると ReferenceCompletionInput が出現する", async () => {
      const { loadScreenItems } = await import("../../store/screenItemsStore");
      vi.mocked(loadScreenItems).mockResolvedValueOnce(FIXTURE_WITH_EVENT_EFFECT_BOOL);

      const { container } = renderWithRouter();
      await startEditingMode(container);
      await expandEventPanel(container);

      // effect row の select を確認 (初期 setReadonly)
      await waitFor(() => {
        const effectRow = container.querySelector(".screen-items-event-effect-row");
        expect(effectRow).not.toBeNull();
        const select = effectRow!.querySelector<HTMLSelectElement>(
          "select.screen-items-event-effect-kind"
        );
        expect(select).not.toBeNull();
        expect(select!.value).toBe("setReadonly");
      }, { timeout: 3000 });

      const effectRow = container.querySelector(".screen-items-event-effect-row")!;
      const kindSelect = effectRow.querySelector<HTMLSelectElement>(
        "select.screen-items-event-effect-kind"
      )!;

      await act(async () => {
        fireEvent.change(kindSelect, { target: { value: "setOptions" } });
      });

      // setOptions 用の placeholder "@options.<name> / catalogRef / 式" が出現すること
      await waitFor(() => {
        const optionsInput = container.querySelector<HTMLInputElement>(
          "input[placeholder='@options.<name> / catalogRef / 式']"
        ) ?? container.querySelector<HTMLElement>("[placeholder='@options.<name> / catalogRef / 式']");
        expect(optionsInput).not.toBeNull();
      }, { timeout: 3000 });
    });

    it("12. value (boolean) checkbox の変更が DOM に反映される (true → false)", async () => {
      const { loadScreenItems } = await import("../../store/screenItemsStore");
      vi.mocked(loadScreenItems).mockResolvedValueOnce(FIXTURE_WITH_EVENT_EFFECT_BOOL);

      const { container } = renderWithRouter();
      await startEditingMode(container);
      await expandEventPanel(container);

      // boolean checkbox が存在し checked=true
      await waitFor(() => {
        const checkbox = container.querySelector<HTMLInputElement>(
          ".screen-items-event-effect-value-boolean input[type='checkbox']"
        );
        expect(checkbox).not.toBeNull();
        expect(checkbox!.checked).toBe(true);
      }, { timeout: 3000 });

      const checkbox = container.querySelector<HTMLInputElement>(
        ".screen-items-event-effect-value-boolean input[type='checkbox']"
      )!;

      await act(async () => {
        fireEvent.click(checkbox);
      });

      await waitFor(() => {
        const updated = container.querySelector<HTMLInputElement>(
          ".screen-items-event-effect-value-boolean input[type='checkbox']"
        );
        expect(updated!.checked).toBe(false);
      }, { timeout: 3000 });
    });

    it("13. 削除ボタンで effect が -1 (1件 → 0件)", async () => {
      const { loadScreenItems } = await import("../../store/screenItemsStore");
      vi.mocked(loadScreenItems).mockResolvedValueOnce(FIXTURE_WITH_EVENT_EFFECT_BOOL);

      const { container } = renderWithRouter();
      await startEditingMode(container);
      await expandEventPanel(container);

      // 初期 1 件
      await waitFor(() => {
        const effectRows = container.querySelectorAll(".screen-items-event-effect-row");
        expect(effectRows.length).toBe(1);
      }, { timeout: 3000 });

      // 削除ボタン (title="効果を削除")
      const delEffectBtn = Array.from(container.querySelectorAll("button")).find(
        (btn) => btn.title === "効果を削除"
      );
      expect(delEffectBtn).not.toBeUndefined();
      await act(async () => {
        fireEvent.click(delEffectBtn!);
      });

      await waitFor(() => {
        const effectRows = container.querySelectorAll(".screen-items-event-effect-row");
        expect(effectRows.length).toBe(0);
      }, { timeout: 3000 });
    });
  });

  // -------------------------------------------------------------------------
  describe("setReadonly UI mode 切替 (#1303 課題 1)", () => {
    it("14. boolean → 式モード切替: 「式に切替」click で checkbox 消えて text input 出現", async () => {
      const { loadScreenItems } = await import("../../store/screenItemsStore");
      vi.mocked(loadScreenItems).mockResolvedValueOnce(FIXTURE_WITH_EVENT_EFFECT_BOOL);

      const { container } = renderWithRouter();
      await startEditingMode(container);
      await expandEventPanel(container);

      // boolean モードの確認 (checkbox あり)
      await waitFor(() => {
        const checkbox = container.querySelector(
          ".screen-items-event-effect-value-boolean input[type='checkbox']"
        );
        expect(checkbox).not.toBeNull();
      }, { timeout: 3000 });

      // 「式に切替」button
      const switchBtn = Array.from(container.querySelectorAll("button")).find(
        (btn) => btn.title === "式モードに切替"
      );
      expect(switchBtn).not.toBeUndefined();
      await act(async () => {
        fireEvent.click(switchBtn!);
      });

      await waitFor(() => {
        // checkbox が消えること
        const checkbox = container.querySelector(
          ".screen-items-event-effect-value-boolean input[type='checkbox']"
        );
        expect(checkbox).toBeNull();
        // expression input が出現すること
        const exprInput = container.querySelector<HTMLInputElement>(
          "input[placeholder='@var.* / TemplateString 式']"
        );
        expect(exprInput).not.toBeNull();
      }, { timeout: 3000 });
    });

    it("15. 式 → boolean モード切替: 「boolean に戻す」click で text input 消えて checkbox 出現", async () => {
      const { loadScreenItems } = await import("../../store/screenItemsStore");
      vi.mocked(loadScreenItems).mockResolvedValueOnce(FIXTURE_WITH_EVENT_EFFECT_EXPR);

      const { container } = renderWithRouter();
      await startEditingMode(container);
      await expandEventPanel(container);

      // expression モードの確認 (text input あり)
      await waitFor(() => {
        const exprInput = container.querySelector<HTMLInputElement>(
          "input[placeholder='@var.* / TemplateString 式']"
        );
        expect(exprInput).not.toBeNull();
      }, { timeout: 3000 });

      // 「boolean に戻す」button
      const switchBtn = Array.from(container.querySelectorAll("button")).find(
        (btn) => btn.title === "boolean モードに切替"
      );
      expect(switchBtn).not.toBeUndefined();
      await act(async () => {
        fireEvent.click(switchBtn!);
      });

      await waitFor(() => {
        // expression input が消えること
        const exprInput = container.querySelector(
          "input[placeholder='@var.* / TemplateString 式']"
        );
        expect(exprInput).toBeNull();
        // checkbox が出現すること (boolean モードに戻った)
        const checkbox = container.querySelector(
          ".screen-items-event-effect-value-boolean input[type='checkbox']"
        );
        expect(checkbox).not.toBeNull();
      }, { timeout: 3000 });
    });
  });

  // -------------------------------------------------------------------------
  describe("items table 行 CRUD", () => {
    it("16. 「項目追加」ボタンで tbody tr が +1 (0件 → 1件)", async () => {
      const { container } = renderWithRouter();

      // 編集モードに切り替え
      await startEditingMode(container);

      // 初期 0 件: table は render されているが tbody の data 行はない
      await waitFor(() => {
        const table = container.querySelector("table");
        expect(table).not.toBeNull();
      }, { timeout: 3000 });

      // .screen-items-add ボタン (「項目追加」の方、最初の 1 つ)
      await waitFor(() => {
        const addBtn = container.querySelector<HTMLButtonElement>(".screen-items-add");
        expect(addBtn).not.toBeNull();
      }, { timeout: 3000 });

      const addBtn = container.querySelector<HTMLButtonElement>(".screen-items-add")!;
      await act(async () => {
        fireEvent.click(addBtn);
      });

      await waitFor(() => {
        // items 行は aria-label="行X を選択" で識別できる (checkbox 列)
        const rowCheckboxes = container.querySelectorAll("[aria-label*='を選択']:not([aria-label='全選択'])");
        expect(rowCheckboxes.length).toBe(1);
      }, { timeout: 3000 });
    });

    it("17. 既存 item の削除ボタンで tbody tr が -1 (2件 → 1件)", async () => {
      const { loadScreenItems } = await import("../../store/screenItemsStore");
      vi.mocked(loadScreenItems).mockResolvedValueOnce(FIXTURE_WITH_TWO_ITEMS);

      const { container } = renderWithRouter();
      await startEditingMode(container);

      // 初期 2 件確認
      await waitFor(() => {
        const rowCheckboxes = container.querySelectorAll("[aria-label*='を選択']:not([aria-label='全選択'])");
        expect(rowCheckboxes.length).toBe(2);
      }, { timeout: 3000 });

      // 最初の削除ボタン (aria-label="削除", title="削除")
      const delBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('[aria-label="削除"]'))[0];
      expect(delBtn).not.toBeUndefined();
      await act(async () => {
        fireEvent.click(delBtn);
      });

      await waitFor(() => {
        const rowCheckboxes = container.querySelectorAll("[aria-label*='を選択']:not([aria-label='全選択'])");
        expect(rowCheckboxes.length).toBe(1);
      }, { timeout: 3000 });
    });

    it("18. 連続「項目追加」2 回で tbody tr が 2 件になる", async () => {
      const { container } = renderWithRouter();

      // 編集モードに切り替え
      await startEditingMode(container);

      // table が render されるまで待つ
      await waitFor(() => {
        const addBtn = container.querySelector<HTMLButtonElement>(".screen-items-add");
        expect(addBtn).not.toBeNull();
      }, { timeout: 3000 });

      const addBtn = container.querySelector<HTMLButtonElement>(".screen-items-add")!;

      // 1 回目追加
      await act(async () => {
        fireEvent.click(addBtn);
      });
      await waitFor(() => {
        const rows = container.querySelectorAll("[aria-label*='を選択']:not([aria-label='全選択'])");
        expect(rows.length).toBe(1);
      }, { timeout: 3000 });

      // 2 回目追加
      await act(async () => {
        fireEvent.click(addBtn);
      });
      await waitFor(() => {
        const rows = container.querySelectorAll("[aria-label*='を選択']:not([aria-label='全選択'])");
        expect(rows.length).toBe(2);
      }, { timeout: 3000 });
    });
  });
});

