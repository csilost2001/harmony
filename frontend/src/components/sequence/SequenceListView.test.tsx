/**
 * SequenceListView — rendering smoke (#1146)
 *
 * 重い 一覧 component。header / 件数 / search input の存在を検証。
 * 詳細 interaction は e2e (sequence/*) に委譲。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { SequenceEntry, DisplayName, PhysicalName, Timestamp, SequenceId } from "../../types/v3";

let mockEntries: SequenceEntry[] = [];

vi.mock("../../store/sequenceStore", () => ({
  listSequences: vi.fn(() => Promise.resolve(mockEntries)),
  createSequence: vi.fn(),
  loadSequence: vi.fn(),
  saveSequence: vi.fn(),
  commitSequences: vi.fn(() => Promise.resolve()),
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
  DataList: ({ items }: { items: SequenceEntry[] }) => (
    <div data-testid="data-list">{items.length} items</div>
  ),
}));

vi.mock("../common/FilterBar", () => ({ FilterBar: () => null }));
vi.mock("../common/SortBar", () => ({ SortBar: () => null }));
vi.mock("../common/ListContextMenu", () => ({ ListContextMenu: () => null }));
vi.mock("../common/ViewModeToggle", () => ({ ViewModeToggle: () => null }));

const { SequenceListView } = await import("./SequenceListView");

function renderList() {
  return render(
    <MemoryRouter>
      <SequenceListView />
    </MemoryRouter>,
  );
}

function entry(over: Record<string, unknown>): SequenceEntry {
  return ({
    id: "s1" as SequenceId,
    name: "シーケンス1" as DisplayName,
    physicalName: "seq_orders" as PhysicalName,
    updatedAt: "2026-05-17T00:00:00.000Z" as Timestamp,
    ...over,
  } as unknown) as SequenceEntry;
}

describe("SequenceListView", () => {
  beforeEach(() => {
    mockEntries = [];
  });

  it("renders header title", () => {
    const { container } = renderList();
    expect(container.textContent).toContain("シーケンス定義");
  });

  it("shows 0 件 when empty", () => {
    const { container } = renderList();
    expect(container.textContent).toContain("0 件");
  });

  it("renders count for given entries", () => {
    mockEntries = [entry({ id: "s1" as SequenceId }), entry({ id: "s2" as SequenceId })];
    const { container } = renderList();
    expect(container.textContent).toContain("2 件");
  });

  it("renders 追加 button", () => {
    const { container } = renderList();
    const buttons = Array.from(container.querySelectorAll("button"));
    const addBtn = buttons.find((b) => b.textContent?.includes("シーケンス追加"));
    expect(addBtn).toBeTruthy();
  });
});
