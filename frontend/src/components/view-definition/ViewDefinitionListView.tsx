import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type {
  ViewDefinition,
  ViewDefinitionEntry,
  ViewDefinitionId,
  ViewDefinitionKind,
  DisplayName,
  TableId,
  Timestamp,
} from "../../types/v3";
import {
  listViewDefinitions,
  createViewDefinition,
  loadViewDefinition,
  saveViewDefinition,
  loadViewDefinitionValidationMap,
  commitViewDefinitions,
} from "../../store/viewDefinitionStore";
import { listTables } from "../../store/tableStore";
import { loadProject } from "../../store/flowStore";
import { generateUUID } from "../../utils/uuid";
import { mcpBridge } from "../../mcp/mcpBridge";
import { makeTabId, openTab } from "../../store/tabStore";
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
import type { TableEntry } from "../../types/v3";
import { useDraftRegistry } from "../../hooks/useDraftRegistry";
import "../../styles/table.css";
import "../../styles/editMode.css";

const STORAGE_KEY = "list-view-mode:view-definition-list";
const TAB_ID = makeTabId("view-definition-list", "main");

interface ValidationSummary {
  errors: number;
  warnings: number;
}

const KIND_LABELS: Record<string, string> = {
  list: "一覧",
  detail: "詳細",
  kanban: "カンバン",
  calendar: "カレンダー",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ja-JP");
  } catch {
    return iso;
  }
}

export function ViewDefinitionListView() {
  const navigate = useNavigate();
  const { hasDraft } = useDraftRegistry();
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = usePersistentState<ViewMode>(STORAGE_KEY, "card");
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addKind, setAddKind] = useState<ViewDefinitionKind>("list");
  const [addSourceTableId, setAddSourceTableId] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addNameError, setAddNameError] = useState("");
  const [addSourceTableError, setAddSourceTableError] = useState("");
  const [tableList, setTableList] = useState<TableEntry[]>([]);
  const [tableNameMap, setTableNameMap] = useState<Map<string, string>>(new Map());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [validationMap, setValidationMap] = useState<Map<string, ValidationSummary>>(new Map());

  // テーブル一覧を初期ロード
  useEffect(() => {
    listTables()
      .then((tables) => {
        setTableList(tables);
        const map = new Map<string, string>();
        for (const t of tables) {
          map.set(t.id, t.name);
        }
        setTableNameMap(map);
      })
      .catch(console.error);
  }, []);

  const loadViewDefs = useCallback(async () => {
    mcpBridge.startWithoutEditor();
    await loadProject();
    return await listViewDefinitions();
  }, []);

  const editor = useListEditor<ViewDefinitionEntry>({
    getId: (v) => String(v.id),
    load: loadViewDefs,
    commit: commitViewDefinitions,
    tabId: TAB_ID,
    renumber,
  });

  useEffect(() => {
    editor.reload();
    const unsubStatus = mcpBridge.onStatusChange((s) => {
      if (s === "connected" && !editor.isDirty) editor.reload();
    });
    const unsubVd = mcpBridge.onBroadcast("viewDefinitionChanged", () => {
      if (!editor.isDirty) editor.reload();
    });
    const unsubProj = mcpBridge.onBroadcast("projectChanged", () => {
      if (!editor.isDirty) editor.reload();
    });
    return () => { unsubStatus(); unsubVd(); unsubProj(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allViewDefs = editor.items;

  useEffect(() => {
    if (allViewDefs.length === 0) {
      setValidationMap(new Map());
      return;
    }
    let cancelled = false;
    loadViewDefinitionValidationMap()
      .then((map) => {
        if (cancelled) return;
        const next = new Map<string, ValidationSummary>();
        for (const [id, issues] of map) {
          next.set(String(id), {
            errors: issues.filter((e) => e.severity === "error").length,
            warnings: issues.filter((e) => e.severity === "warning").length,
          });
        }
        setValidationMap(next);
      })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [allViewDefs]);

  const getErrorPriority = useCallback((id: string): number => {
    const v = validationMap.get(id);
    if (!v) return 0;
    if (v.errors > 0) return 2;
    if (v.warnings > 0) return 1;
    return 0;
  }, [validationMap]);

  const filter = useListFilter(allViewDefs);
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      filter.applyFilter(null);
      return;
    }
    filter.applyFilter((v) =>
      v.name.toLowerCase().includes(q) ||
      (v.kind ?? "").toLowerCase().includes(q) ||
      (tableNameMap.get(String(v.sourceTableId ?? "")) ?? "").toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tableNameMap]);

  const sortAccessor = useCallback((v: ViewDefinitionEntry, key: string): string | number => {
    switch (key) {
      case "name": return v.name;
      case "kind": return v.kind ?? "";
      case "sourceTableId": return tableNameMap.get(String(v.sourceTableId ?? "")) ?? "";
      case "columnCount": return v.columnCount ?? 0;
      case "updatedAt": return v.updatedAt;
      default: return "";
    }
  }, [tableNameMap]);

  const sort = useListSort(filter.filtered, sortAccessor);
  const selection = useListSelection(sort.sorted, (v) => String(v.id));
  const clipboard = useListClipboard<ViewDefinitionEntry>((v) => String(v.id));

  const handleActivate = useCallback((v: ViewDefinitionEntry) => {
    if (editor.isDeleted(String(v.id))) return;
    navigate(`/view-definition/edit/${encodeURIComponent(String(v.id))}`);
  }, [navigate, editor]);

  const handleDelete = (items: ViewDefinitionEntry[]) => {
    editor.markDeleted(items.map((v) => String(v.id)));
  };

  const handleDuplicate = async (items: ViewDefinitionEntry[]) => {
    const newIds: string[] = [];
    for (const m of items) {
      const full = await loadViewDefinition(String(m.id));
      if (!full) continue;
      const ts = new Date().toISOString() as Timestamp;
      const newId = generateUUID() as ViewDefinitionId;
      const completed: ViewDefinition = {
        ...full,
        id: newId,
        name: `${full.name} のコピー` as DisplayName,
        createdAt: ts,
        updatedAt: ts,
      };
      await saveViewDefinition(completed);
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

  const moveBlock = (items: ViewDefinitionEntry[], direction: "up" | "down") => {
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
    name: "表示名",
    kind: "種別",
    sourceTableId: "ソーステーブル",
    columnCount: "カラム数",
    updatedAt: "更新日",
  }), []);

  const resetAddForm = () => {
    setAddName("");
    setAddKind("list");
    setAddSourceTableId("");
    setAddDescription("");
    setAddNameError("");
    setAddSourceTableError("");
  };

  const handleAdd = async () => {
    const name = addName.trim();
    const sourceTableId = addSourceTableId.trim();
    let hasError = false;
    if (!name) {
      setAddNameError("表示名は必須です");
      hasError = true;
    }
    if (!sourceTableId) {
      setAddSourceTableError("ソーステーブルは必須です");
      hasError = true;
    }
    if (hasError) return;

    const vd = await createViewDefinition(
      name as DisplayName,
      addKind as ViewDefinitionKind,
      sourceTableId as TableId,
      addDescription.trim() || undefined,
    );
    setShowAdd(false);
    resetAddForm();
    openTab({
      id: makeTabId("view-definition", String(vd.id)),
      type: "view-definition",
      resourceId: String(vd.id),
      label: vd.name,
    });
    navigate(`/view-definition/edit/${encodeURIComponent(String(vd.id))}`);
  };

  const buildMenuItems = (target: ViewDefinitionEntry | null): ContextMenuItem[] => {
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
    ];
  };

  const handleContextMenu = (e: React.MouseEvent, target: ViewDefinitionEntry | null) => {
    setContextMenu({ x: e.clientX, y: e.clientY, items: buildMenuItems(target) });
  };

  const handleContextMenuKey = (first: ViewDefinitionEntry | null, rect: DOMRect | null) => {
    if (first && !selection.isSelected(String(first.id))) {
      selection.setSelectedIds(new Set<string>([String(first.id)]));
    }
    const x = rect ? rect.left : 100;
    const y = rect ? rect.bottom : 100;
    setContextMenu({ x, y, items: buildMenuItems(first) });
  };

  const handleRowDelete = (v: ViewDefinitionEntry) => {
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

  const columns = useMemo<DataListColumn<ViewDefinitionEntry>[]>(() => [
    {
      key: "draft",
      header: "",
      width: "32px",
      align: "center",
      render: (v) => hasDraft("view-definition", String(v.id))
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
      key: "kind",
      header: "種別",
      width: "110px",
      sortable: true,
      sortAccessor: (v) => v.kind ?? "",
      render: (v) => v.kind
        ? (
          <span className="vd-kind-badge">
            {KIND_LABELS[v.kind] ?? v.kind}
          </span>
        )
        : null,
    },
    {
      key: "sourceTableId",
      header: "ソーステーブル",
      sortable: true,
      sortAccessor: (v) => tableNameMap.get(String(v.sourceTableId ?? "")) ?? "",
      render: (v) => {
        const tblName = tableNameMap.get(String(v.sourceTableId ?? ""));
        return tblName
          ? <code className="seq-list-name-code">{tblName}</code>
          : v.sourceTableId
            ? <code className="seq-list-name-code vd-unknown-table">{String(v.sourceTableId)}</code>
            : null;
      },
    },
    {
      key: "columnCount",
      header: "カラム数",
      width: "90px",
      align: "center",
      sortable: true,
      sortAccessor: (v) => v.columnCount ?? 0,
      render: (v) => <span>{v.columnCount ?? 0}</span>,
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
      sortAccessor: (v) => getErrorPriority(String(v.id)),
      render: (v) => {
        const validation = validationMap.get(String(v.id));
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
    {
      key: "updatedAt",
      header: "更新日",
      width: "120px",
      sortable: true,
      sortAccessor: (v) => v.updatedAt,
      render: (v) => <span className="seq-list-date">{formatDate(v.updatedAt)}</span>,
    },
  ], [getErrorPriority, validationMap, tableNameMap, hasDraft]);

  const renderCard = (v: ViewDefinitionEntry) => {
    const validation = validationMap.get(String(v.id));
    const hasError = (validation?.errors ?? 0) > 0;
    const hasWarning = (validation?.warnings ?? 0) > 0;
    const tblName = tableNameMap.get(String(v.sourceTableId ?? ""));
    return (
      <div className={`seq-card-content${hasError ? " has-error" : hasWarning ? " has-warning" : ""}`}>
        <div className="seq-card-header">
          <MaturityBadge maturity={v.maturity} />
          <span className="seq-card-name">{v.name}</span>
          {hasDraft("view-definition", String(v.id)) && (
            <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
          )}
          {v.kind && (
            <span className="vd-kind-badge vd-kind-badge--card">
              {KIND_LABELS[v.kind] ?? v.kind}
            </span>
          )}
          {validation && (hasError || hasWarning) && (
            <span className="view-validation-badges">
              <ValidationBadge severity="error" count={validation.errors} />
              <ValidationBadge severity="warning" count={validation.warnings} />
            </span>
          )}
        </div>
        {tblName && (
          <div className="seq-card-description">
            <i className="bi bi-table" /> <code>{tblName}</code>
            {v.columnCount !== undefined && (
              <span className="vd-col-count"> ({v.columnCount} 列)</span>
            )}
          </div>
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
            <i className="bi bi-layout-text-window" /> ビュー定義一覧
            <span className="table-list-count">
              {allViewDefs.length - deletedCount} 件{deletedCount > 0 ? ` (削除予定 ${deletedCount})` : ""}
            </span>
          </h2>
          <div className="table-list-actions">
            <div className="table-list-search">
              <i className="bi bi-search" />
              <input
                type="text"
                placeholder="表示名・種別・テーブル名で絞り込み..."
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
              <i className="bi bi-plus-lg" /> ビュー定義追加
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
          className="view-definitions-data-list"
          isItemGhost={(id) => editor.isDeleted(id)}
          emptyMessage={
            query
              ? <p>該当するビュー定義がありません</p>
              : <p>ビュー定義がまだありません。「ビュー定義追加」から作成してください。</p>
          }
        />

        {showAdd && (
          <div
            className="tbl-modal-overlay"
            onClick={() => { setShowAdd(false); resetAddForm(); }}
          >
            <div className="tbl-modal" onClick={(e) => e.stopPropagation()}>
              <div className="tbl-modal-title">ビュー定義追加</div>
              <label className="tbl-field">
                <span>表示名</span>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => { setAddName(e.target.value); setAddNameError(""); }}
                  placeholder="顧客一覧"
                  autoFocus
                  className={addNameError ? "input-error" : undefined}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                />
                {addNameError && <span className="tbl-field-error">{addNameError}</span>}
              </label>
              <label className="tbl-field">
                <span>viewer 種別</span>
                <select
                  value={addKind}
                  onChange={(e) => setAddKind(e.target.value as ViewDefinitionKind)}
                >
                  <option value="list">list — 一覧</option>
                  <option value="detail">detail — 詳細</option>
                  <option value="kanban">kanban — カンバン</option>
                  <option value="calendar">calendar — カレンダー</option>
                </select>
              </label>
              <label className="tbl-field">
                <span>ソーステーブル</span>
                <select
                  value={addSourceTableId}
                  onChange={(e) => { setAddSourceTableId(e.target.value); setAddSourceTableError(""); }}
                  className={addSourceTableError ? "input-error" : undefined}
                >
                  <option value="">— テーブルを選択 —</option>
                  {tableList.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {addSourceTableError && <span className="tbl-field-error">{addSourceTableError}</span>}
              </label>
              <label className="tbl-field">
                <span>説明 <small>(任意)</small></span>
                <textarea
                  value={addDescription}
                  onChange={(e) => setAddDescription(e.target.value)}
                  placeholder="このビュー定義の用途を記述..."
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
                  disabled={!addName.trim() || !addSourceTableId.trim()}
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
