import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { View, ViewEntry, ViewId, PhysicalName, DisplayName, Timestamp } from "../../types/v3";
import { listViews, createView, loadView, saveView, loadViewValidationMap, commitViews } from "../../store/viewStore";
import { loadProject } from "../../store/flowStore";
import { generateUUID } from "../../utils/uuid";
import { mcpBridge } from "../../mcp/mcpBridge";
import { makeTabId } from "../../store/tabStore";
import { MaturityBadge } from "../process-flow/MaturityBadge";
import { DataList, type DataListColumn } from "../common/DataList";
import { FilterBar } from "../common/FilterBar";
import { SortBar } from "../common/SortBar";
import { ListContextMenu, type ContextMenuItem } from "../common/ListContextMenu";
import { ViewModeToggle, type ViewMode } from "../common/ViewModeToggle";
import { ValidationBadge } from "../common/ValidationBadge";
import { useListSelection } from "../../hooks/useListSelection";
import { useListClipboard } from "../../hooks/useListClipboard";
import { useListKeyboard } from "../../hooks/useListKeyboard";
import { useListFilter } from "../../hooks/useListFilter";
import { useListSort } from "../../hooks/useListSort";
import { useListEditor } from "../../hooks/useListEditor";
import { usePersistentState } from "../../hooks/usePersistentState";
import { renumber } from "../../utils/listOrder";
import { useDraftRegistry } from "../../hooks/useDraftRegistry";
import "../../styles/table.css";
import "../../styles/editMode.css";

const STORAGE_KEY = "list-view-mode:view-list";
const TAB_ID = makeTabId("view-list", "main");

interface ValidationSummary {
  errors: number;
  warnings: number;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ja-JP");
  } catch {
    return iso;
  }
}

export function ViewListView() {
  const navigate = useNavigate();
  const { hasDraft } = useDraftRegistry();
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = usePersistentState<ViewMode>(STORAGE_KEY, "card");
  const [showAdd, setShowAdd] = useState(false);
  const [addPhysicalName, setAddPhysicalName] = useState("");
  const [addName, setAddName] = useState("");
  const [addPhysicalNameError, setAddPhysicalNameError] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [validationMap, setValidationMap] = useState<Map<string, ValidationSummary>>(new Map());

  const loadViews = useCallback(async () => {
    mcpBridge.startWithoutEditor();
    await loadProject();
    return await listViews();
  }, []);

  const editor = useListEditor<ViewEntry>({
    getId: (v) => v.id,
    load: loadViews,
    commit: commitViews,
    tabId: TAB_ID,
    renumber,
  });

  useEffect(() => {
    editor.reload();
    const unsubStatus = mcpBridge.onStatusChange((s) => {
      if (s === "connected" && !editor.isDirty) editor.reload();
    });
    const unsubView = mcpBridge.onBroadcast("viewChanged", () => {
      if (!editor.isDirty) editor.reload();
    });
    const unsubProj = mcpBridge.onBroadcast("projectChanged", () => {
      if (!editor.isDirty) editor.reload();
    });
    return () => { unsubStatus(); unsubView(); unsubProj(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allViews = editor.items;

  useEffect(() => {
    if (allViews.length === 0) {
      setValidationMap(new Map());
      return;
    }
    let cancelled = false;
    loadViewValidationMap()
      .then((map) => {
        if (cancelled) return;
        const next = new Map<string, ValidationSummary>();
        for (const [id, errors] of map) {
          next.set(id, {
            errors: errors.filter((e) => e.severity === "error").length,
            warnings: errors.filter((e) => e.severity === "warning").length,
          });
        }
        setValidationMap(next);
      })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [allViews]);

  const getErrorPriority = useCallback((id: string): number => {
    const v = validationMap.get(id);
    if (!v) return 0;
    if (v.errors > 0) return 2;
    if (v.warnings > 0) return 1;
    return 0;
  }, [validationMap]);

  const filter = useListFilter(allViews);
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      filter.applyFilter(null);
      return;
    }
    filter.applyFilter((v) =>
      v.name.toLowerCase().includes(q) ||
      (v.physicalName ?? "").toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const sortAccessor = useCallback((v: ViewEntry, key: string): string | number => {
    switch (key) {
      case "name": return v.name;
      case "physicalName": return v.physicalName ?? "";
      case "updatedAt": return v.updatedAt;
      default: return "";
    }
  }, []);

  const sort = useListSort(filter.filtered, sortAccessor);
  const selection = useListSelection(sort.sorted, (v) => v.id);
  const clipboard = useListClipboard<ViewEntry>((v) => v.id);

  const handleActivate = useCallback((v: ViewEntry) => {
    if (editor.isDeleted(v.id)) return;
    navigate(`/view/edit/${encodeURIComponent(v.id)}`);
  }, [navigate, editor]);

  const handleDelete = (items: ViewEntry[]) => {
    editor.markDeleted(items.map((v) => v.id));
  };

  const makeCopyPhysicalName = (basePhysical: string, existing: Set<string>): string => {
    let candidate = basePhysical + "_copy";
    let n = 2;
    while (existing.has(candidate)) {
      candidate = `${basePhysical}_copy_${n}`;
      n++;
    }
    return candidate;
  };

  const handleDuplicate = async (items: ViewEntry[]) => {
    const newIds: string[] = [];
    const existingPhysical = new Set<string>(editor.items.map((v) => v.physicalName ?? ""));
    for (const m of items) {
      const full = await loadView(m.id);
      if (!full) continue;
      const newPhysical = makeCopyPhysicalName(full.physicalName ?? full.name, existingPhysical);
      existingPhysical.add(newPhysical);
      const ts = new Date().toISOString() as Timestamp;
      const newId = generateUUID() as ViewId;
      const completed: View = {
        ...full,
        id: newId,
        physicalName: newPhysical as PhysicalName,
        createdAt: ts,
        updatedAt: ts,
      };
      await saveView(completed);
      newIds.push(newId);
    }
    await editor.reload();
    if (newIds.length > 0) selection.setSelectedIds(new Set<string>(newIds));
  };

  const handlePaste = async (insertIdx: number | null) => {
    const mode = clipboard.clipboard.mode;
    const clipItems = clipboard.clipboard.items;
    if (!clipItems.length) return;

    if (mode === "cut") {
      const cutIds = new Set<string>(clipItems.map((c) => c.id));
      const selIds = selection.selectedIds;
      const sameSet = selIds.size === cutIds.size && [...selIds].every((id) => cutIds.has(id));
      if (sameSet) return;

      clipboard.consume();
      const moved = clipItems;
      const pos0 = insertIdx ?? editor.items.length;
      const removedBefore = editor.items.slice(0, pos0).filter((v) => cutIds.has(v.id)).length;
      const remaining = editor.items.filter((v) => !cutIds.has(v.id));
      const pos = Math.min(remaining.length, pos0 - removedBefore);
      editor.setItems(() => {
        const next = [...remaining];
        next.splice(pos, 0, ...moved);
        return renumber(next);
      });
      selection.setSelectedIds(new Set<string>(moved.map((v) => v.id)));
    } else {
      await handleDuplicate(clipItems);
      clipboard.consume();
    }
  };

  const handleReorder = (fromIdx: number, toIdx: number) => {
    const visible = sort.sorted;
    const fromId = visible[fromIdx]?.id;
    const toId = visible[toIdx]?.id;
    if (!fromId || !toId) return;
    const realFrom = editor.items.findIndex((v) => v.id === fromId);
    const realTo = editor.items.findIndex((v) => v.id === toId);
    if (realFrom < 0 || realTo < 0) return;
    editor.reorder(realFrom, realTo);
  };

  const moveBlock = (items: ViewEntry[], direction: "up" | "down") => {
    const ids = new Set(items.map((v) => v.id));
    const idxs = editor.items
      .map((v, i) => (ids.has(v.id) ? i : -1))
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
    name: "表示名",
    physicalName: "物理名",
    updatedAt: "更新日",
  }), []);

  const handleAdd = async () => {
    const physical = addPhysicalName.trim();
    const name = addName.trim();
    if (!physical || !name) return;
    if (editor.items.some((v) => v.physicalName === physical)) {
      setAddPhysicalNameError(`物理名 "${physical}" は既に存在します`);
      return;
    }
    const v = await createView(physical as PhysicalName, name as DisplayName);
    setShowAdd(false);
    setAddPhysicalName("");
    setAddName("");
    setAddPhysicalNameError("");
    navigate(`/view/edit/${encodeURIComponent(v.id)}`);
  };

  const buildMenuItems = (target: ViewEntry | null): ContextMenuItem[] => {
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

    const items = target && !selection.isSelected(target.id)
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
          const allIds: string[] = editor.items.map((v) => v.id);
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
    ];
  };

  const handleContextMenu = (e: React.MouseEvent, target: ViewEntry | null) => {
    setContextMenu({ x: e.clientX, y: e.clientY, items: buildMenuItems(target) });
  };

  const handleContextMenuKey = (first: ViewEntry | null, rect: DOMRect | null) => {
    if (first && !selection.isSelected(first.id)) {
      selection.setSelectedIds(new Set<string>([first.id]));
    }
    const x = rect ? rect.left : 100;
    const y = rect ? rect.bottom : 100;
    setContextMenu({ x, y, items: buildMenuItems(first) });
  };

  const handleRowDelete = (v: ViewEntry) => {
    handleDelete([v]);
  };

  useListKeyboard({
    items: sort.sorted,
    getId: (v) => v.id,
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

  const columns = useMemo<DataListColumn<ViewEntry>[]>(() => [
    {
      key: "draft",
      header: "",
      width: "32px",
      align: "center",
      render: (v) => hasDraft("view", v.id)
        ? <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
        : null,
    },
    {
      key: "name",
      header: "表示名",
      sortable: true,
      sortAccessor: (v) => v.name,
      render: (v) => <span>{v.name}</span>,
    },
    {
      key: "physicalName",
      header: "物理名",
      sortable: true,
      sortAccessor: (v) => v.physicalName ?? "",
      render: (v) => v.physicalName
        ? <code className="seq-list-name-code">{v.physicalName}</code>
        : null,
    },
    {
      key: "updatedAt",
      header: "更新日",
      width: "120px",
      sortable: true,
      sortAccessor: (v) => v.updatedAt,
      render: (v) => <span className="seq-list-date">{formatDate(v.updatedAt)}</span>,
    },
    {
      key: "maturity",
      header: "成熟度",
      width: "80px",
      align: "center",
      sortable: true,
      sortAccessor: (v) => {
        const order: Record<string, number> = { draft: 0, provisional: 1, committed: 2 };
        return order[v.maturity ?? "draft"] ?? 0;
      },
      render: (v) => <MaturityBadge maturity={v.maturity} />,
    },
    {
      key: "validation",
      header: "検証",
      width: "100px",
      align: "center",
      sortable: true,
      sortAccessor: (v) => getErrorPriority(v.id),
      render: (v) => {
        const validation = validationMap.get(v.id);
        if (!validation) return null;
        if (validation.errors > 0) {
          return <ValidationBadge severity="error" count={validation.errors} />;
        }
        if (validation.warnings > 0) {
          return <ValidationBadge severity="warning" count={validation.warnings} />;
        }
        return <i className="bi bi-check-lg view-validation-ok" title="問題なし" />;
      },
    },
  ], [getErrorPriority, validationMap, hasDraft]);

  const renderCard = (v: ViewEntry) => {
    const validation = validationMap.get(v.id);
    const hasError = (validation?.errors ?? 0) > 0;
    const hasWarning = (validation?.warnings ?? 0) > 0;
    return (
      <div className={`seq-card-content${hasError ? " has-error" : hasWarning ? " has-warning" : ""}`}>
        <div className="seq-card-header">
          <MaturityBadge maturity={v.maturity} />
          <span className="seq-card-name">{v.name}</span>
          {hasDraft("view", v.id) && (
            <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
          )}
          {validation && (hasError || hasWarning) && (
            <span className="view-validation-badges">
              <ValidationBadge severity="error" count={validation.errors} />
              <ValidationBadge severity="warning" count={validation.warnings} />
            </span>
          )}
        </div>
        {v.physicalName && (
          <div className="seq-card-description"><code>{v.physicalName}</code></div>
        )}
        <div className="seq-card-meta">
          <span className="seq-card-date">{formatDate(v.updatedAt)}</span>
        </div>
      </div>
    );
  };

  const selectedCount = selection.selectedIds.size;
  const deletedCount = editor.deletedIds.size;

  return (
    <div className="table-list-page">
      <div className="table-list-content">
        <div className="table-list-header">
          <h2 className="table-list-title">
            <i className="bi bi-eye" /> ビュー定義
            <span className="table-list-count">
              {allViews.length - deletedCount} 件{deletedCount > 0 ? ` (削除予定 ${deletedCount})` : ""}
            </span>
          </h2>
          <div className="table-list-actions">
            <div className="table-list-search">
              <i className="bi bi-search" />
              <input
                type="text"
                placeholder="表示名・物理名で絞り込み..."
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
              <i className="bi bi-plus-lg" /> ビュー追加
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
          getId={(v) => v.id}
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
          className="views-data-list"
          isItemGhost={(id) => editor.isDeleted(id)}
          emptyMessage={
            query
              ? <p>該当するビュー定義がありません</p>
              : <p>ビュー定義がまだありません。「ビュー追加」から作成してください。</p>
          }
        />

        {showAdd && (
          <div className="tbl-modal-overlay" onClick={() => { setShowAdd(false); setAddPhysicalNameError(""); }}>
            <div className="tbl-modal" onClick={(e) => e.stopPropagation()}>
              <div className="tbl-modal-title">ビュー追加</div>
              <label className="tbl-field">
                <span>物理名 <small>(snake_case、例: v_customer_with_last_order)</small></span>
                <input
                  type="text"
                  value={addPhysicalName}
                  onChange={(e) => { setAddPhysicalName(e.target.value); setAddPhysicalNameError(""); }}
                  placeholder="v_customer_with_last_order"
                  autoFocus
                  className={addPhysicalNameError ? "input-error" : undefined}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                />
                {addPhysicalNameError && <span className="tbl-field-error">{addPhysicalNameError}</span>}
              </label>
              <label className="tbl-field">
                <span>表示名</span>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="顧客最終購入日ビュー"
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                />
              </label>
              <div className="tbl-modal-btns">
                <button className="tbl-btn tbl-btn-ghost" onClick={() => { setShowAdd(false); setAddPhysicalNameError(""); }}>
                  キャンセル
                </button>
                <button
                  className="tbl-btn tbl-btn-primary"
                  onClick={handleAdd}
                  disabled={!addPhysicalName.trim() || !addName.trim()}
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
      </div>
    </div>
  );
}
