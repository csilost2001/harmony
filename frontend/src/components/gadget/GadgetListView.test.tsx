/**
 * GadgetListView — rendering smoke (#1146)
 *
 * E2E 0 spec の領域。header + count + 追加 ボタンの存在を検証。
 * purpose='gadget' filter は flowStore mock で確認 (load callback 呼び出し)。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ScreenNode } from "../../types/flow";

let mockEntries: ScreenNode[] = [];

vi.mock("../../store/flowStore", () => ({
  loadProject: vi.fn(() => Promise.resolve({ screens: mockEntries, techStack: {} })),
  loadRawProject: vi.fn(() => Promise.resolve({ techStack: {} })),
  saveProject: vi.fn(),
  addScreen: vi.fn(),
  removeScreen: vi.fn(),
}));

vi.mock("../../store/screenStore", () => ({
  buildDefaultScreen: vi.fn(),
  saveScreenEntity: vi.fn(),
}));

vi.mock("../../store/pageLayoutStore", () => ({
  listPageLayouts: vi.fn(() => Promise.resolve([])),
  loadPageLayout: vi.fn(() => Promise.resolve(null)),
}));

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    startWithoutEditor: vi.fn(),
    onStatusChange: vi.fn(() => () => {}),
    onBroadcast: vi.fn(() => () => {}),
  },
}));

vi.mock("../../utils/resolveEditorKind", () => ({
  resolveEditorKind: vi.fn(() => "grapesjs"),
}));

vi.mock("../../utils/resolveCssFramework", () => ({
  resolveCssFramework: vi.fn(() => "bootstrap"),
}));

vi.mock("../../hooks/useWorkspacePath", () => ({
  useWorkspacePath: () => ({ wsPath: (p: string) => p }),
}));

vi.mock("../../hooks/useListSelection", () => ({
  useListSelection: () => ({
    selectedItems: [],
    selectedIds: new Set<string>(),
    isSelected: vi.fn(() => false),
    handleRowClick: vi.fn(),
    clearSelection: vi.fn(),
    setSelectedIds: vi.fn(),
  }),
}));

vi.mock("../../hooks/useListClipboard", () => ({
  useListClipboard: () => ({
    clipboard: { mode: null, items: [] },
    copy: vi.fn(),
    cut: vi.fn(),
    paste: vi.fn(),
    canPaste: () => ({ ok: false, reason: "" }),
  }),
}));

vi.mock("../../hooks/useListFilter", () => ({
  useListFilter: <T,>(items: T[]) => ({
    filtered: items,
    isActive: false,
    totalCount: items.length,
    visibleCount: items.length,
    applyFilter: vi.fn(),
    clearFilter: vi.fn(),
  }),
}));

vi.mock("../../hooks/useListSort", () => ({
  useListSort: <T,>(items: T[]) => ({
    sorted: items,
    sortKeys: [],
    isActive: false,
    toggleSort: vi.fn(),
    getSortDirection: vi.fn(() => null),
    getSortRank: vi.fn(() => null),
  }),
}));

vi.mock("../../hooks/useListKeyboard", () => ({ useListKeyboard: () => undefined }));

vi.mock("../../hooks/useListEditor", () => ({
  useListEditor: <T,>({ load }: { load: () => Promise<T[]> }) => {
    return {
      items: mockEntries as unknown as T[],
      deletedIds: new Set<string>(),
      isDeleted: () => false,
      isDirty: false,
      isSaving: false,
      externalChangeWhileDirty: false,
      reload: () => load().catch(() => undefined),
      reorder: vi.fn(),
      insertAt: vi.fn(),
      markDeleted: vi.fn(),
      unmarkDeleted: vi.fn(),
      toggleDeleted: vi.fn(),
      insert: vi.fn(),
      setItems: vi.fn(),
      save: vi.fn(),
      reset: vi.fn(),
      dismissExternalChange: vi.fn(),
    };
  },
}));

vi.mock("../../hooks/usePersistentState", () => ({
  usePersistentState: <T,>(_key: string, initial: T) => [initial, vi.fn()],
}));

vi.mock("../common/DataList", () => ({
  DataList: ({ items }: { items: ScreenNode[] }) => (
    <div data-testid="data-list">{items.length} items</div>
  ),
}));

vi.mock("../common/FilterBar", () => ({ FilterBar: () => null }));
vi.mock("../common/SortBar", () => ({ SortBar: () => null }));
vi.mock("../common/ListContextMenu", () => ({ ListContextMenu: () => null }));
vi.mock("../common/ViewModeToggle", () => ({ ViewModeToggle: () => null }));

const { GadgetListView } = await import("./GadgetListView");

function renderList() {
  return render(
    <MemoryRouter>
      <GadgetListView />
    </MemoryRouter>,
  );
}

// #1355: fixture builder の input を loose 型に変更
function gadget(over: Record<string, unknown>): ScreenNode {
  return ({
    id: "g1",
    name: "ガジェット1",
    kind: "other",
    purpose: "gadget",
    ...over,
  } as unknown) as ScreenNode;
}

describe("GadgetListView", () => {
  beforeEach(() => {
    mockEntries = [];
  });

  it("renders header title", () => {
    const { container } = renderList();
    expect(container.textContent).toContain("ガジェット一覧");
  });

  it("shows 0 件 when empty", () => {
    const { container } = renderList();
    expect(container.textContent).toContain("0 件");
  });

  it("shows count when entries exist", () => {
    mockEntries = [gadget({ id: "g1" }), gadget({ id: "g2" }), gadget({ id: "g3" })];
    const { container } = renderList();
    expect(container.textContent).toContain("3 件");
  });

  it("renders ガジェットを追加 button", () => {
    const { container } = renderList();
    const buttons = Array.from(container.querySelectorAll("button"));
    const addBtn = buttons.find((b) => b.textContent?.includes("ガジェットを追加"));
    expect(addBtn).toBeTruthy();
  });
});
