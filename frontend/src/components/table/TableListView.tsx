import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Table, TableEntry, TableId, PhysicalName, DisplayName, Timestamp } from "../../types/v3";
import { type SqlDialect, SQL_DIALECT_LABELS } from "../../utils/ddlGenerator";
import { listTables, createTable, loadTable, saveTable, loadTableValidationMap, commitTables } from "../../store/tableStore";
import { loadProject } from "../../store/flowStore";
import { generateAllDdl, generateAllTableMarkdown } from "../../utils/ddlGenerator";
import { mcpBridge } from "../../mcp/mcpBridge";
import { makeTabId } from "../../store/tabStore";
import { TableSubToolbar } from "./TableSubToolbar";
import { DataList, type DataListColumn } from "../common/DataList";
import { FilterBar } from "../common/FilterBar";
import { SortBar } from "../common/SortBar";
import { ListContextMenu, type ContextMenuItem } from "../common/ListContextMenu";
import { ViewModeToggle, type ViewMode } from "../common/ViewModeToggle";
import { ValidationBadge } from "../common/ValidationBadge";
import { MaturityBadge } from "../process-flow/MaturityBadge";
import { useListSelection } from "../../hooks/useListSelection";
import { useListClipboard } from "../../hooks/useListClipboard";
import { useListKeyboard } from "../../hooks/useListKeyboard";
import { useListFilter } from "../../hooks/useListFilter";
import { useListSort } from "../../hooks/useListSort";
import { useListEditor } from "../../hooks/useListEditor";
import { usePersistentState } from "../../hooks/usePersistentState";
import { generateUUID } from "../../utils/uuid";
import { renumber } from "../../utils/listOrder";
import { useDraftRegistry } from "../../hooks/useDraftRegistry";
import "../../styles/table.css";
import "../../styles/editMode.css";

const STORAGE_KEY = "list-view-mode:table-list";
const TAB_ID = makeTabId("table-list", "main");

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

export function TableListView() {
  const navigate = useNavigate();
  const [projectName, setProjectName] = useState("プロジェクト");
  const [query, setQuery] = useState("");
  const { hasDraft } = useDraftRegistry();
  const [viewMode, setViewMode] = usePersistentState<ViewMode>(STORAGE_KEY, "card");
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addLogical, setAddLogical] = useState("");
  const [addCategory, setAddCategory] = useState("");
  const [exportDialect, setExportDialect] = useState<SqlDialect>("postgresql");
  const [showExport, setShowExport] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [validationMap, setValidationMap] = useState<Map<string, ValidationSummary>>(new Map());

  const loadTables = useCallback(async () => {
    mcpBridge.startWithoutEditor();
    const p = await loadProject();
    setProjectName(p.name);
    return await listTables();
  }, []);

  const commitTableChanges = useCallback(commitTables, []);

  const editor = useListEditor<TableEntry>({
    getId: (t) => t.id,
    load: loadTables,
    commit: commitTableChanges,
    tabId: TAB_ID,
    renumber,
  });

  useEffect(() => {
    editor.reload();
    const unsubStatus = mcpBridge.onStatusChange((s) => {
      if (s === "connected" && !editor.isDirty) editor.reload();
    });
    const unsubProj = mcpBridge.onBroadcast("projectChanged", () => {
      if (!editor.isDirty) editor.reload();
    });
    return () => { unsubStatus(); unsubProj(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allTables = editor.items;

  useEffect(() => {
    if (allTables.length === 0) {
      setValidationMap(new Map());
      return;
    }
    let cancelled = false;
    loadTableValidationMap()
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
  }, [allTables]);

  const getErrorPriority = useCallback((id: string): number => {
    const validation = validationMap.get(id);
    if (!validation) return 0;
    if (validation.errors > 0) return 2;
    if (validation.warnings > 0) return 1;
    return 0;
  }, [validationMap]);

  const filter = useListFilter(allTables);
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      filter.applyFilter(null);
      return;
    }
    filter.applyFilter((t) =>
      t.name.toLowerCase().includes(q) ||
      (t.physicalName ?? "").toLowerCase().includes(q) ||
      (t.category ?? "").toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const sortAccessor = useCallback((t: TableEntry, key: string): string | number => {
    switch (key) {
      case "name": return t.name;
      case "physicalName": return t.physicalName ?? "";
      case "category": return t.category ?? "";
      case "columnCount": return t.columnCount ?? 0;
      case "updatedAt": return t.updatedAt;
      case "errorPriority": return getErrorPriority(t.id);
      default: return "";
    }
  }, [getErrorPriority]);

  const sort = useListSort(filter.filtered, sortAccessor);
  const selection = useListSelection(sort.sorted, (t) => t.id);
  const clipboard = useListClipboard<TableEntry>((t) => t.id);

  const handleActivate = useCallback((t: TableEntry) => {
    if (editor.isDeleted(t.id)) return; // 削除マーク中は編集画面に遷移しない
    navigate(`/table/edit/${t.id}`);
  }, [navigate, editor]);

  const handleDelete = (items: TableEntry[]) => {
    // ghost 方式: マークするだけ
    editor.markDeleted(items.map((t) => t.id));
  };

  const handleReorder = (fromIdx: number, toIdx: number) => {
    // docs/spec/list-common.md §3.9: ソート中は DataList 側で D&D が無効化されており
    // ここには到達しない想定
    const visible = sort.sorted;
    const fromId = visible[fromIdx]?.id;
    const toId = visible[toIdx]?.id;
    if (!fromId || !toId) return;
    const realFrom = editor.items.findIndex((t) => t.id === fromId);
    const realTo = editor.items.findIndex((t) => t.id === toId);
    if (realFrom < 0 || realTo < 0) return;
    editor.reorder(realFrom, realTo);
  };

  const moveBlock = (items: TableEntry[], direction: "up" | "down") => {
    // docs/spec/list-common.md §3.9: ソート中は useListKeyboard 側で Alt+↑↓ が無効化されており
    // ここには到達しない想定
    const ids = new Set(items.map((t) => t.id));
    const idxs = editor.items
      .map((t, i) => (ids.has(t.id) ? i : -1))
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

  const handleDuplicate = async (items: TableEntry[]) => {
    // 複製は新規エンティティ生成 → 即永続化。Column.id (LocalId) は元のまま保持。
    const newIds: string[] = [];
    for (const t of items) {
      const full = await loadTable(t.id);
      if (!full) continue;
      const ts = new Date().toISOString() as Timestamp;
      const dup: Table = {
        ...full,
        id: generateUUID() as TableId,
        physicalName: (full.physicalName + "_copy") as PhysicalName,
        name: (full.name + " (コピー)") as DisplayName,
        // Column.id (LocalId) は内部参照に使われているので維持。新規 Table 内では再衝突しない
        columns: full.columns.map((c) => ({ ...c })),
        indexes: (full.indexes ?? []).map((i) => ({ ...i })),
        createdAt: ts,
        updatedAt: ts,
      };
      await saveTable(dup);
      newIds.push(dup.id);
    }
    await editor.reload();
    if (newIds.length > 0) selection.setSelectedIds(new Set<string>(newIds));
  };

  const handlePaste = async (insertIdx: number | null) => {
    const mode = clipboard.clipboard.mode;
    const clipItems = clipboard.clipboard.items;
    if (!clipItems.length) return;

    if (mode === "cut") {
      // No-op: 貼り付け対象自身が選択中
      const cutIds = new Set<string>(clipItems.map((c) => c.id));
      const selIds = selection.selectedIds;
      const sameSet = selIds.size === cutIds.size && [...selIds].every((id) => cutIds.has(id));
      if (sameSet) return;

      // Cut → 並び替え (draft)
      // docs/spec/list-common.md §3.9: ソート中は useListKeyboard 側で Ctrl+V が無効化されており
      // ここには到達しない想定
      clipboard.consume();
      const moved = clipItems;
      const pos0 = insertIdx ?? editor.items.length;
      const removedBefore = editor.items.slice(0, pos0).filter((t) => cutIds.has(t.id)).length;
      const remaining = editor.items.filter((t) => !cutIds.has(t.id));
      const pos = Math.min(remaining.length, pos0 - removedBefore);
      editor.setItems(() => {
        const next = [...remaining];
        next.splice(pos, 0, ...moved);
        return renumber(next);
      });
      selection.setSelectedIds(new Set(moved.map((t) => t.id)));
    } else {
      // Copy → 新規エンティティ生成 (即永続化)
      const newIds: string[] = [];
      for (const t of clipItems) {
        const full = await loadTable(t.id);
        if (!full) continue;
        const ts = new Date().toISOString() as Timestamp;
        const dup: Table = {
          ...full,
          id: generateUUID() as TableId,
          physicalName: (full.physicalName + "_copy") as PhysicalName,
          name: (full.name + " (コピー)") as DisplayName,
          columns: full.columns.map((c) => ({ ...c })),
          indexes: (full.indexes ?? []).map((i) => ({ ...i })),
          createdAt: ts,
          updatedAt: ts,
        };
        await saveTable(dup);
        newIds.push(dup.id);
      }
      clipboard.consume();
      await editor.reload();
      selection.setSelectedIds(new Set<string>(newIds));
    }
  };

  const sortActive = sort.sortKeys.length > 0;

  const columnLabels = useMemo<Record<string, string>>(() => ({
    physicalName: "物理名",
    name: "表示名",
    category: "カテゴリ",
    columnCount: "カラム",
    updatedAt: "更新日",
  }), []);

  const handleAdd = async () => {
    const physical = addName.trim();
    const display = addLogical.trim();
    if (!physical || !display) return;
    const table = await createTable(physical as PhysicalName, display as DisplayName, "", addCategory || undefined);
    setShowAdd(false);
    setAddName("");
    setAddLogical("");
    setAddCategory("");
    navigate(`/table/edit/${table.id}`);
  };

  // docs/spec/list-common.md §3.11: 右クリックメニュー項目を構築
  const buildMenuItems = (target: TableEntry | null): ContextMenuItem[] => {
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
          const allIds: string[] = editor.items.map((t) => t.id);
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

  const handleContextMenu = (e: React.MouseEvent, target: TableEntry | null) => {
    setContextMenu({ x: e.clientX, y: e.clientY, items: buildMenuItems(target) });
  };

  const handleContextMenuKey = (first: TableEntry | null, rect: DOMRect | null) => {
    if (first && !selection.isSelected(first.id)) {
      selection.setSelectedIds(new Set<string>([first.id]));
    }
    const x = rect ? rect.left : 100;
    const y = rect ? rect.bottom : 100;
    setContextMenu({ x, y, items: buildMenuItems(first) });
  };

  const handleRowDelete = (t: TableEntry) => {
    handleDelete([t]);
  };

  useListKeyboard({
    items: sort.sorted,
    getId: (t) => t.id,
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

  const handleExportDdl = async () => {
    const defs: Table[] = [];
    for (const t of allTables) {
      if (editor.isDeleted(t.id)) continue;
      const td = await loadTable(t.id);
      if (td) defs.push(td);
    }
    const ddl = generateAllDdl(defs, exportDialect);
    downloadText(`${projectName}_ddl.sql`, ddl);
    setShowExport(false);
  };

  const handleExportMarkdown = async () => {
    const defs: Table[] = [];
    for (const t of allTables) {
      if (editor.isDeleted(t.id)) continue;
      const td = await loadTable(t.id);
      if (td) defs.push(td);
    }
    const md = generateAllTableMarkdown(defs, projectName);
    downloadText(`${projectName}_tables.md`, md);
  };

  const handleSave = () => {
    editor.save().catch(console.error);
    selection.clearSelection();
  };

  const handleReset = () => {
    if (!confirm("未保存の変更を破棄してサーバの状態に戻しますか？")) return;
    editor.reset().catch(console.error);
    selection.clearSelection();
  };

  const columns = useMemo<DataListColumn<TableEntry>[]>(() => [
    {
      key: "draft",
      header: "",
      width: "32px",
      align: "center",
      render: (t) => hasDraft("table", t.id)
        ? <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
        : null,
    },
    {
      key: "physicalName",
      header: "物理名",
      sortable: true,
      sortAccessor: (t) => t.physicalName ?? "",
      render: (t) => <code className="table-list-name-code">{t.physicalName ?? ""}</code>,
    },
    {
      key: "name",
      header: "表示名",
      sortable: true,
      sortAccessor: (t) => t.name,
      render: (t) => t.name,
    },
    {
      key: "category",
      header: "カテゴリ",
      width: "120px",
      sortable: true,
      sortAccessor: (t) => t.category ?? "",
      render: (t) => t.category ? <span className="table-card-category">{t.category}</span> : null,
    },
    {
      key: "maturity",
      header: "成熟度",
      width: "80px",
      align: "center",
      sortable: true,
      sortAccessor: (t) => {
        const order: Record<string, number> = { draft: 0, provisional: 1, committed: 2 };
        return order[t.maturity ?? "draft"] ?? 0;
      },
      render: (t) => <MaturityBadge maturity={t.maturity ?? "draft"} />,
    },
    {
      key: "columnCount",
      header: "カラム",
      width: "80px",
      align: "right",
      sortable: true,
      sortAccessor: (t) => t.columnCount ?? 0,
      render: (t) => <span className="table-list-col-count">{t.columnCount ?? 0}</span>,
    },
    {
      key: "validation",
      header: "検証",
      width: "100px",
      align: "center",
      sortable: true,
      sortAccessor: (t) => getErrorPriority(t.id),
      render: (t) => {
        const validation = validationMap.get(t.id);
        if (!validation) return null;
        if (validation.errors > 0) return <ValidationBadge severity="error" count={validation.errors} />;
        if (validation.warnings > 0) return <ValidationBadge severity="warning" count={validation.warnings} />;
        return <i className="bi bi-check-lg view-validation-ok" title="問題なし" />;
      },
    },
    {
      key: "updatedAt",
      header: "更新日",
      width: "120px",
      sortable: true,
      sortAccessor: (t) => t.updatedAt,
      render: (t) => <span className="table-list-date">{formatDate(t.updatedAt)}</span>,
    },
  ], [getErrorPriority, validationMap, hasDraft]);

  const renderCard = (t: TableEntry) => {
    const validation = validationMap.get(t.id);
    const hasError = (validation?.errors ?? 0) > 0;
    const hasWarning = (validation?.warnings ?? 0) > 0;
    return (
      <div className={`table-card-content${hasError ? " has-error" : hasWarning ? " has-warning" : ""}`}>
        <div className="table-card-header">
          <MaturityBadge maturity={t.maturity ?? "draft"} />
          <span className="table-card-name">{t.physicalName ?? ""}</span>
          {t.category && <span className="table-card-category">{t.category}</span>}
          {hasDraft("table", t.id) && (
            <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
          )}
          {validation && (hasError || hasWarning) && (
            <span className="table-validation-badges">
              <ValidationBadge severity="error" count={validation.errors} />
              <ValidationBadge severity="warning" count={validation.warnings} />
            </span>
          )}
        </div>
        <div className="table-card-logical">{t.name}</div>
        <div className="table-card-meta">
          <span><i className="bi bi-columns-gap" /> {t.columnCount ?? 0} カラム</span>
          <span className="table-card-date">{formatDate(t.updatedAt)}</span>
        </div>
      </div>
    );
  };

  const selectedCount = selection.selectedIds.size;
  const deletedCount = editor.deletedIds.size;

  return (
    <div className="table-list-page">
      <TableSubToolbar />

      <div className="table-list-content">
        <div className="table-list-header">
          <h2 className="table-list-title">
            <i className="bi bi-table" /> テーブル設計書
            <span className="table-list-count">{allTables.length - deletedCount} テーブル{deletedCount > 0 ? ` (削除予定 ${deletedCount})` : ""}</span>
          </h2>
          <div className="table-list-actions">
            <div className="table-list-search">
              <i className="bi bi-search" />
              <input
                type="text"
                placeholder="表示名・物理名・カテゴリで絞り込み..."
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
            {allTables.length > 0 && (
              <>
                <button className="tbl-btn tbl-btn-ghost" onClick={handleExportMarkdown} title="Markdown エクスポート">
                  <i className="bi bi-file-earmark-text" /> Markdown
                </button>
                <button className="tbl-btn tbl-btn-ghost" onClick={() => setShowExport(true)} title="DDL エクスポート">
                  <i className="bi bi-code-square" /> DDL
                </button>
              </>
            )}
            <button
              className="tbl-btn tbl-btn-primary"
              onClick={() => setShowAdd(true)}
              disabled={sortActive}
              title={sortActive ? "ソート中は無効 (ソート解除で利用可能)" : undefined}
            >
              <i className="bi bi-plus-lg" /> テーブル追加
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
          getId={(t) => t.id}
          getNo={(t) => t.no}
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
          className="tables-data-list"
          isItemGhost={(id) => editor.isDeleted(id)}
          emptyMessage={
            query
              ? <p>該当するテーブル定義がありません</p>
              : <p>テーブル定義がまだありません。「テーブル追加」から作成してください。</p>
          }
        />

        {/* テーブル追加モーダル */}
        {showAdd && (
          <div className="tbl-modal-overlay" onClick={() => setShowAdd(false)}>
            <div className="tbl-modal" onClick={(e) => e.stopPropagation()}>
              <div className="tbl-modal-title">テーブル追加</div>
              <label className="tbl-field">
                <span>物理名 <small>(snake_case)</small></span>
                <input
                  type="text"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder="customers"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                />
              </label>
              <label className="tbl-field">
                <span>表示名</span>
                <input
                  type="text"
                  value={addLogical}
                  onChange={(e) => setAddLogical(e.target.value)}
                  placeholder="顧客マスタ"
                  onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
                />
              </label>
              <label className="tbl-field">
                <span>カテゴリ</span>
                <select value={addCategory} onChange={(e) => setAddCategory(e.target.value)}>
                  <option value="">（なし）</option>
                  <option value="マスタ">マスタ</option>
                  <option value="トランザクション">トランザクション</option>
                  <option value="中間テーブル">中間テーブル</option>
                  <option value="ログ">ログ</option>
                  <option value="設定">設定</option>
                  <option value="その他">その他</option>
                </select>
              </label>
              <div className="tbl-modal-btns">
                <button className="tbl-btn tbl-btn-ghost" onClick={() => setShowAdd(false)}>
                  キャンセル
                </button>
                <button
                  className="tbl-btn tbl-btn-primary"
                  onClick={handleAdd}
                  disabled={!addName.trim() || !addLogical.trim()}
                >
                  作成して編集
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DDL エクスポートモーダル */}
        {showExport && (
          <div className="tbl-modal-overlay" onClick={() => setShowExport(false)}>
            <div className="tbl-modal" onClick={(e) => e.stopPropagation()}>
              <div className="tbl-modal-title">DDL エクスポート</div>
              <label className="tbl-field">
                <span>SQL ダイアレクト</span>
                <select
                  value={exportDialect}
                  onChange={(e) => setExportDialect(e.target.value as SqlDialect)}
                >
                  {Object.entries(SQL_DIALECT_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
              <div className="tbl-modal-btns">
                <button className="tbl-btn tbl-btn-ghost" onClick={() => setShowExport(false)}>
                  キャンセル
                </button>
                <button className="tbl-btn tbl-btn-primary" onClick={handleExportDdl}>
                  <i className="bi bi-download" /> ダウンロード
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

function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
