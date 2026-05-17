/**
 * PageLayoutListView — ページレイアウト一覧 (pl-3, #1024)
 *
 * ViewDefinitionListView.tsx を完全踏襲。
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type { DisplayName } from "../../types/v3";
import type { PageLayoutEntry } from "../../types/v3/harmony";
import type { PageLayoutEditorKind, PageLayoutCssFramework } from "../../store/pageLayoutStore";
import {
  listPageLayouts,
  createPageLayout,
  loadPageLayout,
  savePageLayout,
  commitPageLayouts,
} from "../../store/pageLayoutStore";
import { mcpBridge } from "../../mcp/mcpBridge";
import { makeTabId, openTab } from "../../store/tabStore";
import { MaturityBadge } from "../process-flow/MaturityBadge";
import { DataList, type DataListColumn } from "../common/DataList";
import { FilterBar } from "../common/FilterBar";
import { SortBar } from "../common/SortBar";
import { ListContextMenu, type ContextMenuItem } from "../common/ListContextMenu";
import { ViewModeToggle, type ViewMode } from "../common/ViewModeToggle";
import { useListSelection } from "../../hooks/useListSelection";
import { useListClipboard } from "../../hooks/useListClipboard";
import { useListKeyboard } from "../../hooks/useListKeyboard";
import { useListFilter } from "../../hooks/useListFilter";
import { useListSort } from "../../hooks/useListSort";
import { useListEditor } from "../../hooks/useListEditor";
import { usePersistentState } from "../../hooks/usePersistentState";
import { useDraftRegistry } from "../../hooks/useDraftRegistry";
import { EditSessionBadge } from "../editing/EditSessionBadge";
import { DraftHistoryModal } from "../editing/DraftHistoryModal";
import { renumber } from "../../utils/listOrder";
import { generateUUID } from "../../utils/uuid";
import type { Uuid, Timestamp } from "../../types/v3";
import "../../styles/table.css";
import "../../styles/editMode.css";

const STORAGE_KEY = "list-view-mode:page-layout-list";
const TAB_ID = makeTabId("page-layout-list", "main");

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ja-JP");
  } catch {
    return iso;
  }
}

export function PageLayoutListView() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const { hasDraft } = useDraftRegistry();
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = usePersistentState<ViewMode>(STORAGE_KEY, "card");
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEditorKind, setAddEditorKind] = useState<PageLayoutEditorKind>("grapesjs");
  const [addCssFramework, setAddCssFramework] = useState<PageLayoutCssFramework>("bootstrap");
  const [addDescription, setAddDescription] = useState("");
  const [addNameError, setAddNameError] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [historyModal, setHistoryModal] = useState<{ resourceId: string } | null>(null);

  const loadPageLayouts = useCallback(async () => {
    mcpBridge.startWithoutEditor();
    return await listPageLayouts();
  }, []);

  const editor = useListEditor<PageLayoutEntry>({
    getId: (v) => String(v.id),
    load: loadPageLayouts,
    commit: commitPageLayouts,
    tabId: TAB_ID,
    renumber,
  });

  useEffect(() => {
    editor.reload();
    const unsubStatus = mcpBridge.onStatusChange((s) => {
      if (s === "connected" && !editor.isDirty) editor.reload();
    });
    const unsubPl = mcpBridge.onBroadcast("pageLayoutChanged", () => {
      if (!editor.isDirty) editor.reload();
    });
    const unsubProj = mcpBridge.onBroadcast("projectChanged", () => {
      if (!editor.isDirty) editor.reload();
    });
    return () => { unsubStatus(); unsubPl(); unsubProj(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allPageLayouts = editor.items;

  const filter = useListFilter(allPageLayouts);
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      filter.applyFilter(null);
      return;
    }
    filter.applyFilter((v) => v.name.toLowerCase().includes(q));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const sortAccessor = useCallback((v: PageLayoutEntry, key: string): string | number => {
    switch (key) {
      case "name": return v.name;
      case "regionCount": return v.regionCount ?? 0;
      case "assignmentCount": return v.assignmentCount ?? 0;
      case "updatedAt": return v.updatedAt;
      default: return "";
    }
  }, []);

  const sort = useListSort(filter.filtered, sortAccessor);
  const selection = useListSelection(sort.sorted, (v) => String(v.id));
  const clipboard = useListClipboard<PageLayoutEntry>((v) => String(v.id));

  const handleActivate = useCallback((v: PageLayoutEntry) => {
    if (editor.isDeleted(String(v.id))) return;
    navigate(wsPath(`/page-layout/edit/${encodeURIComponent(String(v.id))}`));
  }, [navigate, editor, wsPath]);

  const handleDelete = (items: PageLayoutEntry[]) => {
    editor.markDeleted(items.map((v) => String(v.id)));
  };

  const handleDuplicate = async (items: PageLayoutEntry[]) => {
    const newIds: string[] = [];
    for (const m of items) {
      const full = await loadPageLayout(String(m.id));
      if (!full) continue;
      const ts = new Date().toISOString() as Timestamp;
      const newId = generateUUID() as Uuid;
      const copy = {
        ...full,
        id: newId,
        name: `${full.name} のコピー` as DisplayName,
        createdAt: ts,
        updatedAt: ts,
      };
      await savePageLayout(copy);
      newIds.push(String(newId));
    }
    await editor.reload();
    if (newIds.length > 0) selection.setSelectedIds(new Set<string>(newIds));
  };

  const handlePaste = async (insertIdx: number | null) => {
    const mode = clipboard.clipboard.mode;
    const clipItems = clipboard.clipboard.items;
    if (!clipItems.length) return;

    if (mode === "cut") {
      const cutIds = new Set<string>(clipItems.map((c) => String(c.id)));
      const selIds = selection.selectedIds;
      const sameSet = selIds.size === cutIds.size && [...selIds].every((id) => cutIds.has(id));
      if (sameSet) return;

      clipboard.consume();
      const moved = clipItems;
      const pos0 = insertIdx ?? editor.items.length;
      const removedBefore = editor.items.slice(0, pos0).filter((v) => cutIds.has(String(v.id))).length;
      const remaining = editor.items.filter((v) => !cutIds.has(String(v.id)));
      const pos = Math.min(remaining.length, pos0 - removedBefore);
      editor.setItems(() => {
        const next = [...remaining];
        next.splice(pos, 0, ...moved);
        return renumber(next);
      });
      selection.setSelectedIds(new Set<string>(moved.map((v) => String(v.id))));
    } else {
      await handleDuplicate(clipItems);
      clipboard.consume();
    }
  };

  const handleReorder = (fromIdx: number, toIdx: number) => {
    const visible = sort.sorted;
    const fromId = visible[fromIdx] ? String(visible[fromIdx].id) : undefined;
    const toId = visible[toIdx] ? String(visible[toIdx].id) : undefined;
    if (!fromId || !toId) return;
    const realFrom = editor.items.findIndex((v) => String(v.id) === fromId);
    const realTo = editor.items.findIndex((v) => String(v.id) === toId);
    if (realFrom < 0 || realTo < 0) return;
    editor.reorder(realFrom, realTo);
  };

  const moveBlock = (items: PageLayoutEntry[], direction: "up" | "down") => {
    const ids = new Set(items.map((v) => String(v.id)));
    const idxs = editor.items
      .map((v, i) => (ids.has(String(v.id)) ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    if (idxs.length === 0) return;
    if (direction === "up") {
      if (idxs[0] === 0) return;
      editor.setItems((prev) => {
        const next = [...prev];
        const [moved] = next.splice(idxs[0] - 1, 1);
        next.splice(idxs[idxs.length - 1], 0, moved);
        return renumber(next);
      });
    } else {
      if (idxs[idxs.length - 1] === editor.items.length - 1) return;
      editor.setItems((prev) => {
        const next = [...prev];
        const [moved] = next.splice(idxs[idxs.length - 1] + 1, 1);
        next.splice(idxs[0], 0, moved);
        return renumber(next);
      });
    }
  };

  const sortActive = sort.sortKeys.length > 0;

  const columnLabels = useMemo<Record<string, string>>(() => ({
    name: "名前",
    regionCount: "region 数",
    assignmentCount: "assignment 数",
    updatedAt: "更新日",
  }), []);

  const resetAddForm = () => {
    setAddName("");
    setAddEditorKind("grapesjs");
    setAddCssFramework("bootstrap");
    setAddDescription("");
    setAddNameError("");
  };

  const handleAdd = async () => {
    const name = addName.trim();
    if (!name) {
      setAddNameError("名前は必須です");
      return;
    }

    const pl = await createPageLayout(
      name as DisplayName,
      addEditorKind,
      addCssFramework,
      addDescription.trim() || undefined,
    );
    setShowAdd(false);
    resetAddForm();
    openTab({
      id: makeTabId("page-layout", String(pl.id)),
      type: "page-layout",
      resourceId: String(pl.id),
      label: pl.name,
    });
    sessionStorage.setItem(`harmony-auto-edit:page-layout:${pl.id}`, "1");
    navigate(wsPath(`/page-layout/edit/${encodeURIComponent(String(pl.id))}`));
  };

  const buildMenuItems = (target: PageLayoutEntry | null): ContextMenuItem[] => {
    const hasSelection = selection.selectedIds.size > 0 || target !== null;
    const pasteBlocked = sortActive || !clipboard.hasContent;
    const pasteReason = sortActive ? "ソート中は無効 (ソート解除で利用可能)" : "クリップボードが空";
    const sortReason = "ソート中は無効 (ソート解除で利用可能)";

    if (target === null && selection.selectedIds.size === 0) {
      return [
        {
          key: "new", label: "新規作成", icon: "bi-plus-lg",
          disabled: sortActive, disabledReason: sortReason,
          onClick: () => setShowAdd(true),
        },
      ];
    }

    const items = target && !selection.isSelected(String(target.id))
      ? [target]
      : selection.selectedItems;

    return [
      {
        key: "new", label: "新規作成", icon: "bi-plus-lg",
        disabled: sortActive, disabledReason: sortReason,
        onClick: () => setShowAdd(true),
      },
      { key: "sep1", separator: true },
      {
        key: "copy", label: "コピー", icon: "bi-files", shortcut: "Ctrl+C",
        disabled: !hasSelection,
        onClick: () => { if (items.length > 0) clipboard.copy(items); },
      },
      {
        key: "cut", label: "切り取り", icon: "bi-scissors", shortcut: "Ctrl+X",
        disabled: !hasSelection,
        onClick: () => { if (items.length > 0) clipboard.cut(items); },
      },
      {
        key: "paste", label: "貼り付け", icon: "bi-clipboard", shortcut: "Ctrl+V",
        disabled: pasteBlocked, disabledReason: pasteBlocked && sortActive ? sortReason : pasteReason,
        onClick: () => {
          const ids = Array.from(selection.selectedIds);
          const allIds: string[] = editor.items.map((v) => String(v.id));
          const insertIndex = ids.length > 0
            ? Math.max(...ids.map((id) => allIds.indexOf(id))) + 1
            : null;
          handlePaste(insertIndex).catch(console.error);
        },
      },
      { key: "sep2", separator: true },
      {
        key: "duplicate", label: "複製", icon: "bi-copy", shortcut: "Ctrl+D",
        disabled: !hasSelection || sortActive,
        disabledReason: sortActive ? sortReason : undefined,
        onClick: () => { if (items.length > 0) handleDuplicate(items).catch(console.error); },
      },
      { key: "sep3", separator: true },
      {
        key: "delete", label: "削除", icon: "bi-trash", shortcut: "Delete",
        disabled: !hasSelection, danger: true,
        onClick: () => { if (items.length > 0) handleDelete(items); },
      },
      { key: "sep4", separator: true },
      {
        key: "history", label: "履歴 (過去の EditSession)", icon: "bi-clock-history",
        disabled: items.length !== 1,
        disabledReason: items.length !== 1 ? "1 件選択時のみ有効" : undefined,
        onClick: () => {
          if (items.length === 1) setHistoryModal({ resourceId: String(items[0].id) });
        },
      },
    ];
  };

  const handleContextMenu = (e: React.MouseEvent, target: PageLayoutEntry | null) => {
    setContextMenu({ x: e.clientX, y: e.clientY, items: buildMenuItems(target) });
  };

  const handleContextMenuKey = (first: PageLayoutEntry | null, rect: DOMRect | null) => {
    if (first && !selection.isSelected(String(first.id))) {
      selection.setSelectedIds(new Set<string>([String(first.id)]));
    }
    const x = rect ? rect.left : 100;
    const y = rect ? rect.bottom : 100;
    setContextMenu({ x, y, items: buildMenuItems(first) });
  };

  const handleRowDelete = (v: PageLayoutEntry) => {
    handleDelete([v]);
  };

  useListKeyboard({
    items: sort.sorted,
    getId: (v) => String(v.id),
    selection,
    clipboard,
    sort,
    layout: viewMode === "card" ? "grid" : "list",
    onActivate: handleActivate,
    onDelete: handleDelete,
    onDuplicate: (items) => { handleDuplicate(items).catch(console.error); },
    onMoveUp: (items) => moveBlock(items, "up"),
    onMoveDown: (items) => moveBlock(items, "down"),
    onPaste: (idx) => { handlePaste(idx).catch(console.error); },
    onContextMenuKey: handleContextMenuKey,
  });

  const handleSave = () => {
    editor.save().catch(console.error);
    selection.clearSelection();
  };

  const handleReset = () => {
    if (!confirm("未保存の変更を破棄してサーバの状態に戻しますか？")) return;
    editor.reset().catch(console.error);
    selection.clearSelection();
  };

  const columns = useMemo<DataListColumn<PageLayoutEntry>[]>(() => [
    {
      key: "draft",
      header: "",
      width: "32px",
      align: "center",
      render: (v) => hasDraft("page-layout", String(v.id))
        ? <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
        : null,
    },
    {
      key: "session",
      header: "",
      width: "48px",
      align: "center",
      render: (v) => <EditSessionBadge resourceType="page-layout" resourceId={String(v.id)} />,
    },
    {
      key: "name",
      header: "名前",
      sortable: true,
      sortAccessor: (v) => v.name,
      render: (v) => <span>{v.name}</span>,
    },
    {
      key: "regionCount",
      header: "region 数",
      width: "100px",
      align: "center",
      sortable: true,
      sortAccessor: (v) => v.regionCount ?? 0,
      render: (v) => <span>{v.regionCount ?? 0}</span>,
    },
    {
      key: "assignmentCount",
      header: "assignment 数",
      width: "120px",
      align: "center",
      sortable: true,
      sortAccessor: (v) => v.assignmentCount ?? 0,
      render: (v) => <span>{v.assignmentCount ?? 0}</span>,
    },
    {
      key: "hasProcessFlow",
      header: "処理フロー",
      width: "90px",
      align: "center",
      render: (v) => v.hasProcessFlow
        ? <i className="bi bi-lightning-charge-fill" title="ProcessFlow あり" style={{ color: "#f59e0b" }} />
        : null,
    },
    {
      key: "maturity",
      header: "成熟度",
      width: "80px",
      align: "center",
      sortable: true,
      sortAccessor: (v) => {
        const order: Record<string, number> = { draft: 0, reviewing: 1, committed: 2 };
        return order[v.maturity ?? "draft"] ?? 0;
      },
      render: (v) => <MaturityBadge maturity={v.maturity} />,
    },
    {
      key: "updatedAt",
      header: "更新日",
      width: "120px",
      sortable: true,
      sortAccessor: (v) => v.updatedAt,
      render: (v) => <span className="seq-list-date">{formatDate(v.updatedAt)}</span>,
    },
  ], [hasDraft]);

  const renderCard = (v: PageLayoutEntry) => (
    <div className="seq-card-content">
      <div className="seq-card-header">
        <MaturityBadge maturity={v.maturity} />
        <span className="seq-card-name">{v.name}</span>
        {hasDraft("page-layout", String(v.id)) && (
          <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
        )}
        <EditSessionBadge resourceType="page-layout" resourceId={String(v.id)} />
        {v.hasProcessFlow && (
          <i className="bi bi-lightning-charge-fill" title="ProcessFlow あり" style={{ color: "#f59e0b", fontSize: "0.75rem" }} />
        )}
      </div>
      <div className="seq-card-description">
        <i className="bi bi-layout-wtf" />
        {" "}{v.regionCount ?? 0} region
        {v.assignmentCount ? ` / ${v.assignmentCount} assignment` : ""}
      </div>
      <div className="seq-card-meta">
        <span className="seq-card-date">{formatDate(v.updatedAt)}</span>
      </div>
    </div>
  );

  const selectedCount = selection.selectedIds.size;
  const deletedCount = editor.deletedIds.size;

  return (
    <div className="table-list-page">
      <div className="table-list-content">
        <div className="table-list-header">
          <h2 className="table-list-title">
            <i className="bi bi-layout-wtf" /> ページレイアウト一覧
            <span className="table-list-count">
              {allPageLayouts.length - deletedCount} 件{deletedCount > 0 ? ` (削除予定 ${deletedCount})` : ""}
            </span>
          </h2>
          <div className="table-list-actions">
            <div className="table-list-search">
              <i className="bi bi-search" />
              <input
                type="text"
                placeholder="名前で絞り込み..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button className="clear-btn" onClick={() => setQuery("")} title="クリア">
                  <i className="bi bi-x-circle-fill" />
                </button>
              )}
            </div>
            <ViewModeToggle mode={viewMode} onChange={setViewMode} storageKey={STORAGE_KEY} />
            <button
              className="tbl-btn tbl-btn-primary"
              onClick={() => setShowAdd(true)}
              disabled={sortActive}
              title={sortActive ? "ソート中は無効 (ソート解除で利用可能)" : undefined}
            >
              <i className="bi bi-plus-lg" /> ページレイアウト追加
            </button>
            <button
              className="tbl-btn tbl-btn-ghost danger"
              onClick={() => handleDelete(selection.selectedItems)}
              disabled={selectedCount === 0}
              title="削除 (Delete)"
            >
              <i className="bi bi-trash" /> 削除{selectedCount > 0 ? ` (${selectedCount})` : ""}
            </button>
            <span className="tbl-saveline-sep" />
            <button
              className="tbl-btn tbl-btn-ghost"
              data-testid="list-reset-btn"
              onClick={handleReset}
              disabled={!editor.isDirty || editor.isSaving}
              title="変更を破棄"
            >
              <i className="bi bi-arrow-counterclockwise" /> リセット
            </button>
            <button
              className="tbl-btn tbl-btn-primary"
              data-testid="list-save-btn"
              onClick={handleSave}
              disabled={!editor.isDirty || editor.isSaving}
              title="変更を保存"
            >
              <i className="bi bi-save" /> {editor.isSaving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>

        <FilterBar
          isActive={filter.isActive}
          totalCount={filter.totalCount}
          visibleCount={filter.visibleCount}
          label={query ? `検索: "${query}"` : undefined}
          onClear={() => { setQuery(""); filter.clearFilter(); }}
        />

        <SortBar sort={sort} columnLabels={columnLabels} />

        <DataList
          items={sort.sorted}
          columns={columns}
          getId={(v) => String(v.id)}
          getNo={(v) => v.no}
          onRowDelete={handleRowDelete}
          onContextMenu={handleContextMenu}
          selection={selection}
          clipboard={clipboard}
          sort={sort}
          onActivate={handleActivate}
          onReorder={handleReorder}
          layout={viewMode === "card" ? "grid" : "list"}
          renderCard={renderCard}
          showNumColumn={viewMode === "table"}
          variant="dark"
          className="page-layouts-data-list"
          isItemGhost={(id) => editor.isDeleted(id)}
          emptyMessage={
            query
              ? <p>該当するページレイアウトがありません</p>
              : <p>ページレイアウトがまだありません。「ページレイアウト追加」から作成してください。</p>
          }
        />

        {showAdd && (
          <div
            className="tbl-modal-overlay"
            onClick={() => { setShowAdd(false); resetAddForm(); }}
          >
            <div className="tbl-modal" onClick={(e) => e.stopPropagation()}>
              <div className="tbl-modal-title">ページレイアウト追加</div>
              <label className="tbl-field">
                <span>名前</span>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => { setAddName(e.target.value); setAddNameError(""); }}
                  placeholder="Main Layout"
                  autoFocus
                  className={addNameError ? "input-error" : undefined}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                />
                {addNameError && <span className="tbl-field-error">{addNameError}</span>}
              </label>
              <label className="tbl-field">
                <span>エディタ種別</span>
                <select
                  value={addEditorKind}
                  onChange={(e) => setAddEditorKind(e.target.value as PageLayoutEditorKind)}
                >
                  <option value="grapesjs">grapesjs — GrapesJS WYSIWYG</option>
                  <option value="puck">puck — Puck ブロックエディタ</option>
                </select>
              </label>
              <label className="tbl-field">
                <span>CSS フレームワーク</span>
                <select
                  value={addCssFramework}
                  onChange={(e) => setAddCssFramework(e.target.value as PageLayoutCssFramework)}
                >
                  <option value="bootstrap">bootstrap — Bootstrap 5</option>
                  <option value="tailwind">tailwind — Tailwind CSS</option>
                </select>
              </label>
              <label className="tbl-field">
                <span>説明 <small>(任意)</small></span>
                <textarea
                  value={addDescription}
                  onChange={(e) => setAddDescription(e.target.value)}
                  placeholder="このレイアウトの用途を記述..."
                  rows={3}
                />
              </label>
              <div className="tbl-modal-btns">
                <button
                  className="tbl-btn tbl-btn-ghost"
                  onClick={() => { setShowAdd(false); resetAddForm(); }}
                >
                  キャンセル
                </button>
                <button
                  className="tbl-btn tbl-btn-primary"
                  onClick={handleAdd}
                  disabled={!addName.trim()}
                >
                  作成して編集
                </button>
              </div>
            </div>
          </div>
        )}

        {contextMenu && (
          <ListContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={contextMenu.items}
            onClose={() => setContextMenu(null)}
          />
        )}

        {historyModal && (
          <DraftHistoryModal
            resourceType="page-layout"
            resourceId={historyModal.resourceId}
            isOpen={true}
            onClose={() => setHistoryModal(null)}
            onRestore={(editSessionId) => {
              setHistoryModal(null);
              navigate(wsPath(`/page-layout/edit/${encodeURIComponent(historyModal.resourceId)}?session=${encodeURIComponent(editSessionId)}`));
            }}
          />
        )}
      </div>
    </div>
  );
}
