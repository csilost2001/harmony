/**
 * ViewListView — rendering smoke (#1146)
 *
 * heavy 一覧 component。基本 rendering / empty state / count display を
 * 検証する。複雑なドラフト編集 / 並び替え / コピペは E2E で担保 (e2e: view/*)。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ViewEntry, DisplayName, PhysicalName, Timestamp, ViewId } from "../../types/v3";

// ─── mocks ────────────────────────────────────────────────────────────────

let mockEntries: ViewEntry[] = [];

vi.mock("../../store/viewStore", () => ({
  listViews: vi.fn(() => Promise.resolve(mockEntries)),
  createView: vi.fn(),
  loadView: vi.fn(),
  saveView: vi.fn(),
  loadViewValidationMap: vi.fn(() => Promise.resolve(new Map())),
  commitViews: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../store/flowStore", () => ({
  loadProject: vi.fn(() => Promise.resolve({})),
}));

vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: {
    startWithoutEditor: vi.fn(),
    onStatusChange: vi.fn(() => () => {}),
    onBroadcast: vi.fn(() => () => {}),
  },
}));

vi.mock("../../hooks/useWorkspacePath", () => ({
  useWorkspacePath: () => ({ wsPath: (p: string) => p }),
}));

vi.mock("../../hooks/useDraftRegistry", () => ({
  useDraftRegistry: () => ({ hasDraft: vi.fn(() => false) }),
}));

// 重い list-common 系 hook を簡易 stub
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

vi.mock("../../hooks/useListKeyboard", () => ({
  useListKeyboard: () => undefined,
}));

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

// 一覧の中身を表示しない簡易 stub (描画コスト削減)
vi.mock("../common/DataList", () => ({
  DataList: ({ items }: { items: ViewEntry[] }) => (
    <div data-testid="data-list">{items.length} items</div>
  ),
}));

vi.mock("../common/FilterBar", () => ({ FilterBar: () => null }));
vi.mock("../common/SortBar", () => ({ SortBar: () => null }));
vi.mock("../common/ListContextMenu", () => ({ ListContextMenu: () => null }));
vi.mock("../common/ViewModeToggle", () => ({ ViewModeToggle: () => null }));
vi.mock("../common/ValidationBadge", () => ({ ValidationBadge: () => null }));
vi.mock("../process-flow/MaturityBadge", () => ({ MaturityBadge: () => null }));

const { ViewListView } = await import("./ViewListView");

function renderList() {
  return render(
    <MemoryRouter>
      <ViewListView />
    </MemoryRouter>,
  );
}

function entry(over: Record<string, unknown>): ViewEntry {
  return ({
    id: "v1" as ViewId,
    name: "ビュー1" as DisplayName,
    physicalName: "v_users" as PhysicalName,
    updatedAt: "2026-05-17T00:00:00.000Z" as Timestamp,
    ...over,
  } as unknown) as ViewEntry;
}

describe("ViewListView", () => {
  beforeEach(() => {
    mockEntries = [];
  });

  it("renders header title", () => {
    const { container } = renderList();
    expect(container.textContent).toContain("ビュー定義");
  });

  it("shows 0 件 when no entries", () => {
    const { container } = renderList();
    expect(container.textContent).toContain("0 件");
  });

  it("renders 2 件 count when 2 entries exist", () => {
    mockEntries = [entry({ id: "v1" as ViewId }), entry({ id: "v2" as ViewId, name: "ビュー2" as DisplayName })];
    const { container } = renderList();
    expect(container.textContent).toContain("2 件");
  });

  it("renders search input placeholder", () => {
    const { container } = renderList();
    const input = container.querySelector<HTMLInputElement>(".table-list-search input");
    expect(input?.placeholder).toContain("絞り込み");
  });
});
