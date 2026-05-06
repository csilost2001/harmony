import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type { Table, Column, BuiltinDataType, PhysicalName, DisplayName, LocalId, Maturity, SemVer } from "../../types/v3";
import {
  DATA_TYPE_LABELS,
  COLUMN_TEMPLATES,
  DATA_TYPES_WITH_LENGTH,
  DATA_TYPES_WITH_SCALE,
  TABLE_CATEGORIES,
  type ColumnTemplate,
} from "./tableConstants";
import type { SqlDialect } from "../../utils/ddlGenerator";
import { loadTable, saveTable, addColumn, removeColumn } from "../../store/tableStore";
import { listTables } from "../../store/tableStore";
import { generateDdl, generateTableMarkdown } from "../../utils/ddlGenerator";
import { mcpBridge } from "../../mcp/mcpBridge";
import { useResourceEditor } from "../../hooks/useResourceEditor";
import { useEditSession } from "../../hooks/useEditSession";
import { useSaveShortcut } from "../../hooks/useSaveShortcut";
import { useListSelection } from "../../hooks/useListSelection";
import { useListClipboard } from "../../hooks/useListClipboard";
import { useListKeyboard } from "../../hooks/useListKeyboard";
import { useListSort } from "../../hooks/useListSort";
import { EditorHeader } from "../common/EditorHeader";
import { ServerChangeBanner } from "../common/ServerChangeBanner";
import { DataList, type DataListColumn } from "../common/DataList";
import { SortBar } from "../common/SortBar";
import { ListContextMenu, type ContextMenuItem } from "../common/ListContextMenu";
import { DdlPreviewDrawer } from "./DdlPreviewDrawer";
import { ConstraintsTab } from "./ConstraintsTab";
import { IndexesTab } from "./IndexesTab";
import { TriggersDefaultsTab } from "./TriggersDefaultsTab";
import { renumber } from "../../utils/listOrder";
import { EditModeToolbar } from "../editing/EditModeToolbar";
import { DiscardConfirmDialog, ForceReleaseConfirmDialog, ForcedOutChoiceDialog, AfterForceUnlockChoiceDialog } from "../editing/ConfirmDialogs";
import { ResumeOrDiscardDialog } from "../editing/ResumeOrDiscardDialog";
import { setDirty as setTabDirty, makeTabId } from "../../store/tabStore";
import "../../styles/table.css";
import "../../styles/editMode.css";

type TabId = "columns" | "constraints" | "indexes" | "triggers" | "comment";

export function TableEditor() {
  const { tableId } = useParams<{ tableId: string }>();
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [tab, setTab] = useState<TabId>("columns");
  const [ddlDialect, setDdlDialect] = useState<SqlDialect>("postgresql");
  const ddlOpen = window.innerWidth >= 2560;
  const [editingMeta, setEditingMeta] = useState(false);
  const [allTables, setAllTables] = useState<Table[]>([]);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showForceReleaseDialog, setShowForceReleaseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);

  const handleNotFound = useCallback(() => navigate(wsPath("/table/list"), { replace: true }), [navigate, wsPath]);

  const sessionId = mcpBridge.getSessionId();

  const {
    state: table,
    isDirty, isSaving, serverChanged,
    update, undo, redo, canUndo, canRedo,
    handleSave: resourceHandleSave, handleReset, dismissServerBanner,
    reload,
  } = useResourceEditor<Table>({
    tabType: "table",
    mtimeKind: "table",
    draftKind: "table",
    id: tableId,
    load: loadTable,
    save: saveTable,
    broadcastName: "tableChanged",
    broadcastIdField: "tableId",
    onNotFound: handleNotFound,
  });

  const { mode, loading: sessionLoading, isDirtyForTab, actions } = useEditSession({
    resourceType: "table",
    resourceId: tableId ?? "",
    sessionId,
  });

  const isReadonly = mode.kind !== "editing";

  const tableRef = useRef<Table | null>(null);
  useEffect(() => { tableRef.current = table ?? null; }, [table]);

  const draftUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateWithDraft = useCallback((fn: (t: Table) => void) => {
    if (isReadonly) return;
    update(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!tableId || !tableRef.current) return;
      mcpBridge.updateDraft("table", tableId, tableRef.current).catch(console.error);
    }, 300);
  }, [isReadonly, update, tableId]);

  const handleSave = useCallback(async () => {
    if (isReadonly || isSaving) return;
    await resourceHandleSave();
    await actions.save();
  }, [isReadonly, isSaving, resourceHandleSave, actions]);

  const handleDiscard = useCallback(async () => {
    setShowDiscardDialog(false);
    await actions.discard();
    await reload();
  }, [actions, reload]);

  const handleForceRelease = useCallback(async () => {
    setShowForceReleaseDialog(false);
    await actions.forceReleaseOther();
  }, [actions]);

  const handleResumeContinue = useCallback(async () => {
    setShowResumeDialog(false);
    await actions.startEditing();
  }, [actions]);

  const handleResumeDiscard = useCallback(async () => {
    setShowResumeDialog(false);
    if (tableId) await mcpBridge.discardDraft("table", tableId);
    await reload();
  }, [tableId, reload]);

  useSaveShortcut(() => {
    if (isDirty && !isSaving && !isReadonly) handleSave();
  });

  useEffect(() => {
    if (!tableId) return;
    const tabId = makeTabId("table", tableId);
    setTabDirty(tabId, isDirtyForTab || isDirty);
  }, [tableId, isDirtyForTab, isDirty]);

  useEffect(() => {
    if (!tableId || sessionLoading) return;
    if (mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      const res = await mcpBridge.hasDraft("table", tableId) as { exists: boolean } | null;
      if (cancelled) return;
      if (res?.exists) setShowResumeDialog(true);
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [tableId, sessionLoading, mode.kind]);

  useEffect(() => {
    mcpBridge.startWithoutEditor();
    (async () => {
      const tl = await listTables();
      const allTds: Table[] = [];
      for (const m of tl) {
        const td = await loadTable(m.id);
        if (td) allTds.push(td);
      }
      setAllTables(allTds);
    })();
  }, [tableId]);

  if (!table || sessionLoading) {
    return <div className="table-editor-loading"><i className="bi bi-hourglass-split" /> 読み込み中...</div>;
  }

  const ddl = generateDdl(table, ddlDialect, allTables);
  const columnsEmpty = table.columns.length === 0;
  const primaryKeyEmpty = !table.columns.some((column) => column.primaryKey);
  const lockedByOther = mode.kind === "locked-by-other" ? mode : null;

  return (
    <div className={`table-editor-page${isReadonly ? " readonly-mode" : ""}`}>
      {serverChanged && (
        <ServerChangeBanner onReload={handleReset} onDismiss={dismissServerBanner} />
      )}

      <EditModeToolbar
        mode={mode}
        onStartEditing={actions.startEditing}
        onSave={handleSave}
        onDiscardClick={() => setShowDiscardDialog(true)}
        onForceReleaseClick={() => setShowForceReleaseDialog(true)}
        saving={isSaving}
        ownerLabel={lockedByOther?.ownerSessionId}
      />

      {mode.kind === "force-released-pending" && (
        <ForcedOutChoiceDialog
          previousDraftExists={mode.previousDraftExists}
          onChoice={(choice) => actions.handleForcedOut(choice)}
        />
      )}

      {mode.kind === "after-force-unlock" && (
        <AfterForceUnlockChoiceDialog
          previousOwner={mode.previousOwner}
          onChoice={(choice) => actions.handleAfterForceUnlock(choice)}
        />
      )}

      {showResumeDialog && (
        <ResumeOrDiscardDialog
          onResume={handleResumeContinue}
          onDiscard={handleResumeDiscard}
          onCancel={() => setShowResumeDialog(false)}
        />
      )}

      {showDiscardDialog && (
        <DiscardConfirmDialog
          onConfirm={handleDiscard}
          onCancel={() => setShowDiscardDialog(false)}
        />
      )}

      {showForceReleaseDialog && lockedByOther && (
        <ForceReleaseConfirmDialog
          ownerSessionId={lockedByOther.ownerSessionId}
          onConfirm={handleForceRelease}
          onCancel={() => setShowForceReleaseDialog(false)}
        />
      )}

      <EditorHeader
        variant="dark"
        backLink={{ label: "テーブル一覧", onClick: () => navigate(wsPath("/table/list")) }}
        title={
          editingMeta && !isReadonly ? (
            <TableMetaEditor
              table={table}
              onSave={(patch) => {
                updateWithDraft((t) => Object.assign(t, patch));
                setEditingMeta(false);
              }}
              onCancel={() => setEditingMeta(false)}
            />
          ) : (
            <div
              className="table-editor-title"
              onClick={() => { if (!isReadonly) setEditingMeta(true); }}
              title={isReadonly ? undefined : "クリックして編集"}
            >
              <span className="table-name-display">{table.physicalName}</span>
              <span className="table-logical-display">{table.name}</span>
              {table.category && <span className="table-category-badge">{table.category}</span>}
              {!isReadonly && <i className="bi bi-pencil table-edit-icon" />}
            </div>
          )
        }
        undoRedo={{ onUndo: undo, onRedo: redo, canUndo, canRedo }}
        extraRight={
          <button
            className="editor-header-undo-btn"
            onClick={() => {
              const md = generateTableMarkdown(table);
              navigator.clipboard.writeText(md);
            }}
            title="Markdown をコピー"
          >
            <i className="bi bi-clipboard" />
          </button>
        }
        saveReset={isReadonly ? undefined : { isDirty, isSaving, onSave: handleSave, onReset: () => setShowDiscardDialog(true) }}
      />

      <div className="table-editor-tabs">
        <button className={tab === "columns" ? "active" : ""} onClick={() => setTab("columns")}>
          <i className="bi bi-columns-gap" /> 列 <span className="tab-count">{table.columns.length}</span>
          {columnsEmpty && (
            <span className="view-editor-section-marker" style={{ color: "orange", marginLeft: 6 }} title="カラムが未定義です">{"⚠️"}</span>
          )}
          {primaryKeyEmpty && (
            <span className="view-editor-section-marker" style={{ color: "orange", marginLeft: 6 }} title="主キーが未指定です">{"⚠️"}</span>
          )}
        </button>
        <button className={tab === "constraints" ? "active" : ""} onClick={() => setTab("constraints")}>
          <i className="bi bi-shield-check" /> 制約
          {(table.constraints?.length ?? 0) > 0 && (
            <span className="tab-count">{table.constraints?.length}</span>
          )}
        </button>
        <button className={tab === "indexes" ? "active" : ""} onClick={() => setTab("indexes")}>
          <i className="bi bi-lightning" /> インデックス <span className="tab-count">{table.indexes?.length ?? 0}</span>
        </button>
        <button className={tab === "triggers" ? "active" : ""} onClick={() => setTab("triggers")}>
          <i className="bi bi-play-btn" /> トリガー/DEFAULT
          {((table.triggers?.length ?? 0) + (table.defaults?.length ?? 0)) > 0 && (
            <span className="tab-count">{(table.triggers?.length ?? 0) + (table.defaults?.length ?? 0)}</span>
          )}
        </button>
        <button className={tab === "comment" ? "active" : ""} onClick={() => setTab("comment")}>
          <i className="bi bi-chat-left-text" /> コメント
        </button>
      </div>

      <div className="table-editor-content-area">
        <div className="table-editor-body">
          {tab === "columns" && (
            <ColumnsTab table={table} update={isReadonly ? () => {} : updateWithDraft} />
          )}
          {tab === "constraints" && (
            <ConstraintsTab table={table} update={isReadonly ? () => {} : updateWithDraft} allTables={allTables} />
          )}
          {tab === "indexes" && (
            <IndexesTab key="indexes" table={table} update={isReadonly ? () => {} : updateWithDraft} />
          )}
          {tab === "triggers" && (
            <TriggersDefaultsTab table={table} update={isReadonly ? () => {} : updateWithDraft} />
          )}
          {tab === "comment" && (
            <CommentTab table={table} update={isReadonly ? () => {} : updateWithDraft} />
          )}
        </div>

        <DdlPreviewDrawer
          ddl={ddl}
          dialect={ddlDialect}
          onDialectChange={setDdlDialect}
          defaultOpen={ddlOpen}
        />
      </div>
    </div>
  );
}

// ── メタ情報編集 ──────────────────────────────────────────────────────────────

function TableMetaEditor({
  table, onSave, onCancel,
}: {
  table: Table;
  onSave: (patch: Partial<Table>) => void;
  onCancel: () => void;
}) {
  const [physicalName, setPhysicalName] = useState<string>(table.physicalName);
  const [name, setName] = useState<string>(table.name);
  const [description, setDescription] = useState<string>(table.description ?? "");
  const [category, setCategory] = useState<string>(table.category ?? "");
  const [maturity, setMaturity] = useState<string>(table.maturity ?? "");
  const [version, setVersion] = useState<string>(table.version ?? "");
  const physicalNameEmpty = !physicalName.trim();

  return (
    <div className="table-meta-editor">
      <input
        className="table-meta-input name"
        value={physicalName}
        onChange={(e) => setPhysicalName(e.target.value)}
        placeholder="物理名 (snake_case)"
        autoFocus
      />
      {physicalNameEmpty && (
        <span className="view-editor-section-marker" style={{ color: "red", marginLeft: 2 }} title="物理名が必須です">{"\u26A0\uFE0F"}</span>
      )}
      <input
        className="table-meta-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="表示名"
      />
      <input
        className="table-meta-input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="説明"
      />
      <select className="table-meta-input" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">カテゴリなし</option>
        {TABLE_CATEGORIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <select className="table-meta-input" value={maturity} onChange={(e) => setMaturity(e.target.value)}>
        <option value="">成熟度: 未指定</option>
        <option value="draft">draft（下書き）</option>
        <option value="provisional">provisional（暫定）</option>
        <option value="committed">committed（確定）</option>
      </select>
      <input
        className="table-meta-input"
        value={version}
        onChange={(e) => setVersion(e.target.value)}
        placeholder="バージョン (SemVer 例: 1.0.0)"
        pattern="^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$"
      />
      <div className="table-meta-btns">
        <button className="tbl-btn tbl-btn-ghost tbl-btn-sm" onClick={onCancel}>キャンセル</button>
        <button
          className="tbl-btn tbl-btn-primary tbl-btn-sm"
          onClick={() =>
            onSave({
              physicalName: physicalName.trim() as PhysicalName,
              name: name.trim() as DisplayName,
              description: description || undefined,
              category: category || undefined,
              maturity: (maturity || undefined) as Maturity | undefined,
              version: (version || undefined) as SemVer | undefined,
            })
          }
          disabled={!physicalName.trim() || !name.trim()}
        >
          保存
        </button>
      </div>
    </div>
  );
}

// ── カラムタブ ────────────────────────────────────────────────────────────────

function ColumnsTab({
  table, update,
}: {
  table: Table;
  update: (fn: (t: Table) => void) => void;
}) {
  const [showTemplates, setShowTemplates] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [activeColId, setActiveColId] = useState<string | null>(null);

  const sortAccessor = useCallback((col: Column, key: string): string | number => {
    switch (key) {
      case "physicalName": return col.physicalName;
      case "name": return col.name;
      case "dataType": return col.dataType;
      case "length": return col.length ?? 0;
      case "notNull": return col.notNull ? 1 : 0;
      case "primaryKey": return col.primaryKey ? 1 : 0;
      case "unique": return col.unique ? 1 : 0;
      case "autoIncrement": return col.autoIncrement ? 1 : 0;
      case "defaultValue": return col.defaultValue ?? "";
      default: return "";
    }
  }, []);

  const sort = useListSort(table.columns, sortAccessor);
  const selection = useListSelection(sort.sorted, (c) => c.id);
  const clipboard = useListClipboard<Column>((c) => c.id);

  // FK column id 集合 (ColumnsTab で FK アイコン表示用)
  const fkColumnIds = useMemo(() => {
    const set = new Set<string>();
    for (const c of table.constraints ?? []) {
      if (c.kind === "foreignKey") {
        for (const id of c.columnIds) set.add(id);
      }
    }
    return set;
  }, [table.constraints]);

  const handleUpdateCol = useCallback((colId: string, patch: Partial<Column>) => {
    update((t) => {
      const col = t.columns.find((c) => c.id === colId);
      if (col) Object.assign(col, patch);
    });
  }, [update]);

  const handleAddBlank = () => {
    let newColId: string = "";
    update((t) => { newColId = addColumn(t).id; });
    selection.setSelectedIds(new Set<string>([newColId]));
    setActiveColId(newColId);
  };

  const handleAddFromTemplate = (tpl: ColumnTemplate) => {
    let newColId: string = "";
    update((t) => { newColId = addColumn(t, { ...tpl.column }).id; });
    selection.setSelectedIds(new Set<string>([newColId]));
    setActiveColId(newColId);
    setShowTemplates(false);
  };

  const handleDelete = (cols: Column[]) => {
    const ids = new Set(cols.map((c) => c.id));
    update((t) => {
      for (const id of ids) removeColumn(t, id);
    });
    selection.clearSelection();
    if (activeColId && ids.has(activeColId as LocalId)) setActiveColId(null);
  };

  const handleDuplicate = (cols: Column[]) => {
    const newIds: string[] = [];
    update((t) => {
      for (const src of cols) {
        const cur = t.columns.find((c) => c.id === src.id);
        if (!cur) continue;
        newIds.push(addColumn(t, { ...cur, physicalName: (cur.physicalName + "_copy") as PhysicalName }).id);
      }
    });
    selection.setSelectedIds(new Set<string>(newIds));
  };

  const moveBlock = (cols: Column[], direction: "up" | "down") => {
    const ids = new Set(cols.map((c) => c.id));
    update((t) => {
      const idxs = t.columns
        .map((c, i) => (ids.has(c.id) ? i : -1))
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);
      if (idxs.length === 0) return;
      if (direction === "up") {
        if (idxs[0] === 0) return;
        const [moved] = t.columns.splice(idxs[0] - 1, 1);
        t.columns.splice(idxs[idxs.length - 1], 0, moved);
      } else {
        if (idxs[idxs.length - 1] === t.columns.length - 1) return;
        const [moved] = t.columns.splice(idxs[idxs.length - 1] + 1, 1);
        t.columns.splice(idxs[0], 0, moved);
      }
      t.columns = renumber(t.columns);
    });
  };

  const handleReorder = (fromIdx: number, toIdx: number) => {
    update((t) => {
      const [moved] = t.columns.splice(fromIdx, 1);
      t.columns.splice(toIdx, 0, moved);
      t.columns = renumber(t.columns);
    });
  };

  const handlePaste = (insertIdx: number | null) => {
    const mode = clipboard.clipboard.mode;
    const clipItems = clipboard.clipboard.items;
    if (!clipItems.length) return;

    if (mode === "cut") {
      const cutIds = new Set(clipItems.map((c) => c.id));
      const selIds = selection.selectedIds;
      const sameSet = selIds.size === cutIds.size &&
        [...selIds].every((id) => cutIds.has(id as LocalId));
      if (sameSet) return;
    }

    const consumed = clipboard.consume();
    const newIds: string[] = [];

    update((t) => {
      if (mode === "cut") {
        const cutIds = new Set(consumed.map((c) => c.id));
        const pos0 = insertIdx ?? t.columns.length;
        const removedBefore = t.columns.slice(0, pos0).filter((c) => cutIds.has(c.id)).length;
        t.columns = t.columns.filter((c) => !cutIds.has(c.id));
        const pos = Math.min(t.columns.length, pos0 - removedBefore);
        t.columns.splice(pos, 0, ...consumed);
        newIds.push(...consumed.map((c) => c.id));
      } else {
        // copy: 新規 LocalId を採番 (col-NN は addColumn ヘルパに任せる方が安全)
        for (const src of consumed) {
          const inserted = addColumn(t, { ...src });
          newIds.push(inserted.id);
        }
        // 挿入位置は addColumn が末尾に置くため、ここで insertIdx に並べ替える
        if (insertIdx != null && insertIdx < t.columns.length) {
          const moved = t.columns.splice(t.columns.length - newIds.length, newIds.length);
          t.columns.splice(insertIdx, 0, ...moved);
        }
      }
      t.columns = renumber(t.columns);
    });
    selection.setSelectedIds(new Set<string>(newIds));
  };

  const sortActive = sort.sortKeys.length > 0;

  const buildMenuItems = (target: Column | null): ContextMenuItem[] => {
    const hasSelection = selection.selectedIds.size > 0 || target !== null;
    const pasteBlocked = sortActive || !clipboard.hasContent;
    const pasteReason = sortActive ? "ソート中は無効 (ソート解除で利用可能)" : "クリップボードが空";
    const sortReason = "ソート中は無効 (ソート解除で利用可能)";

    if (target === null && selection.selectedIds.size === 0) {
      return [
        {
          key: "addCol", label: "カラム追加", icon: "bi-plus-lg",
          disabled: sortActive, disabledReason: sortReason,
          onClick: handleAddBlank,
        },
        {
          key: "addTpl", label: "テンプレートから追加", icon: "bi-collection",
          disabled: sortActive, disabledReason: sortReason,
          onClick: () => setShowTemplates(true),
        },
      ];
    }

    const items = target && !selection.isSelected(target.id)
      ? [target]
      : selection.selectedItems;

    return [
      {
        key: "addCol", label: "カラム追加", icon: "bi-plus-lg",
        disabled: sortActive, disabledReason: sortReason,
        onClick: handleAddBlank,
      },
      {
        key: "addTpl", label: "テンプレートから追加", icon: "bi-collection",
        disabled: sortActive, disabledReason: sortReason,
        onClick: () => setShowTemplates(true),
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
          const allIds = (table?.columns ?? []).map((c) => c.id as string);
          const insertIndex = ids.length > 0
            ? Math.max(...ids.map((id) => allIds.indexOf(id))) + 1
            : null;
          handlePaste(insertIndex);
        },
      },
      { key: "sep2", separator: true },
      {
        key: "moveUp", label: "上へ移動", icon: "bi-chevron-up", shortcut: "Alt+↑",
        disabled: !hasSelection || sortActive,
        disabledReason: sortActive ? sortReason : undefined,
        onClick: () => { if (items.length > 0) moveBlock(items, "up"); },
      },
      {
        key: "moveDown", label: "下へ移動", icon: "bi-chevron-down", shortcut: "Alt+↓",
        disabled: !hasSelection || sortActive,
        disabledReason: sortActive ? sortReason : undefined,
        onClick: () => { if (items.length > 0) moveBlock(items, "down"); },
      },
      { key: "sep3", separator: true },
      {
        key: "duplicate", label: "複製", icon: "bi-copy", shortcut: "Ctrl+D",
        disabled: !hasSelection || sortActive,
        disabledReason: sortActive ? sortReason : undefined,
        onClick: () => { if (items.length > 0) handleDuplicate(items); },
      },
      { key: "sep4", separator: true },
      {
        key: "delete", label: "削除", icon: "bi-trash", shortcut: "Delete",
        disabled: !hasSelection, danger: true,
        onClick: () => { if (items.length > 0) handleDelete(items); },
      },
    ];
  };

  const handleContextMenu = (e: React.MouseEvent, target: Column | null) => {
    setContextMenu({ x: e.clientX, y: e.clientY, items: buildMenuItems(target) });
  };

  const handleContextMenuKey = (first: Column | null, rect: DOMRect | null) => {
    if (first && !selection.isSelected(first.id)) {
      selection.setSelectedIds(new Set<string>([first.id]));
    }
    const x = rect ? rect.left : 100;
    const y = rect ? rect.bottom : 100;
    setContextMenu({ x, y, items: buildMenuItems(first) });
  };

  const handleRowDelete = (c: Column) => {
    handleDelete([c]);
  };

  useListKeyboard({
    items: sort.sorted,
    getId: (c) => c.id,
    selection,
    clipboard,
    sort,
    layout: "list",
    onActivate: (c) => setActiveColId(c.id),
    onDelete: handleDelete,
    onDuplicate: handleDuplicate,
    onMoveUp: (cols) => moveBlock(cols, "up"),
    onMoveDown: (cols) => moveBlock(cols, "down"),
    onPaste: handlePaste,
    onContextMenuKey: handleContextMenuKey,
  });

  const columnLabels = useMemo<Record<string, string>>(() => ({
    physicalName: "物理名",
    name: "表示名",
    dataType: "データ型",
    length: "長さ",
    notNull: "NN",
    primaryKey: "PK",
    unique: "UK",
    autoIncrement: "AI",
    defaultValue: "デフォルト",
  }), []);

  // Esc で詳細パネルを閉じる
  useEffect(() => {
    if (!activeColId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (document.querySelector(".list-context-menu")) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (target?.isContentEditable) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setActiveColId(null);
    };
    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [activeColId]);

  useEffect(() => {
    if (activeColId && !table.columns.some((c) => c.id === activeColId)) {
      setActiveColId(null);
    }
  }, [activeColId, table.columns]);

  const detailCol = activeColId ? table.columns.find((c) => c.id === activeColId) ?? null : null;

  const columns = useMemo<DataListColumn<Column>[]>(() => [
    {
      key: "physicalName",
      header: "物理名",
      width: "18%",
      sortable: true,
      sortAccessor: (c) => c.physicalName,
      render: (c) => (
        <>
          <code className="col-name-code">{c.physicalName}</code>
          {fkColumnIds.has(c.id) && <i className="bi bi-link-45deg col-fk-icon" title="外部キー (Constraint で定義)" />}
        </>
      ),
    },
    { key: "name", header: "表示名", width: "18%", sortable: true, sortAccessor: (c) => c.name, render: (c) => c.name },
    {
      key: "dataType",
      header: "データ型",
      width: "10%",
      sortable: true,
      sortAccessor: (c) => c.dataType,
      render: (c) => <span className="col-type-badge">{c.dataType}</span>,
    },
    {
      key: "length",
      header: "長さ",
      width: "60px",
      align: "right",
      sortable: true,
      sortAccessor: (c) => c.length ?? 0,
      render: (c) => (c.length != null ? `${c.length}${c.scale != null ? `,${c.scale}` : ""}` : ""),
    },
    { key: "notNull", header: "NN", width: "44px", align: "center", sortable: true, sortAccessor: (c) => (c.notNull ? 1 : 0), render: (c) => (c.notNull ? <i className="bi bi-check-lg" /> : null) },
    { key: "primaryKey", header: "PK", width: "44px", align: "center", sortable: true, sortAccessor: (c) => (c.primaryKey ? 1 : 0), render: (c) => (c.primaryKey ? <i className="bi bi-key-fill col-pk-icon" /> : null) },
    { key: "unique", header: "UK", width: "44px", align: "center", sortable: true, sortAccessor: (c) => (c.unique ? 1 : 0), render: (c) => (c.unique ? <i className="bi bi-check-lg" /> : null) },
    { key: "autoIncrement", header: "AI", width: "44px", align: "center", sortable: true, sortAccessor: (c) => (c.autoIncrement ? 1 : 0), render: (c) => (c.autoIncrement ? <i className="bi bi-check-lg" /> : null) },
    { key: "defaultValue", header: "デフォルト", width: "14%", sortable: true, sortAccessor: (c) => c.defaultValue ?? "", render: (c) => <code className="col-default-code">{c.defaultValue ?? ""}</code> },
  ], [fkColumnIds]);

  const templateCategories = COLUMN_TEMPLATES.reduce<Record<string, ColumnTemplate[]>>((acc, tpl) => {
    (acc[tpl.category] ??= []).push(tpl);
    return acc;
  }, {});

  const selectedCount = selection.selectedIds.size;
  const anySelected = selectedCount > 0;
  const columnsEmpty = table.columns.length === 0;
  const primaryKeyEmpty = !table.columns.some((column) => column.primaryKey);

  return (
    <div className="columns-tab">
      <div className="columns-selection-bar">
        <span className="columns-selection-count">
          {anySelected ? `${selectedCount} 件選択中 (ダブルクリック/Enter で編集)` : "クリックで選択、ダブルクリックで編集"}
          {columnsEmpty && (
            <span className="view-editor-section-marker" style={{ color: "orange", marginLeft: 6 }} title="カラムが未定義です">{"\u26A0\uFE0F"}</span>
          )}
          {primaryKeyEmpty && (
            <span className="view-editor-section-marker" style={{ color: "orange", marginLeft: 6 }} title="主キーが未指定です">{"\u26A0\uFE0F"}</span>
          )}
        </span>
        <div className="columns-selection-actions">
          <button
            className="tbl-btn tbl-btn-ghost tbl-btn-sm"
            disabled={!anySelected || sortActive}
            onClick={() => moveBlock(selection.selectedItems, "up")}
            title={sortActive ? "ソート中は無効 (ソート解除で利用可能)" : "上へ移動 (Alt+↑)"}
          >
            <i className="bi bi-chevron-up" /> 上へ
          </button>
          <button
            className="tbl-btn tbl-btn-ghost tbl-btn-sm"
            disabled={!anySelected || sortActive}
            onClick={() => moveBlock(selection.selectedItems, "down")}
            title={sortActive ? "ソート中は無効 (ソート解除で利用可能)" : "下へ移動 (Alt+↓)"}
          >
            <i className="bi bi-chevron-down" /> 下へ
          </button>
          <button
            className="tbl-btn tbl-btn-ghost tbl-btn-sm"
            disabled={!anySelected || sortActive}
            onClick={() => handleDuplicate(selection.selectedItems)}
            title={sortActive ? "ソート中は無効 (ソート解除で利用可能)" : "複製 (Ctrl+D)"}
          >
            <i className="bi bi-copy" /> 複製
          </button>
          <button className="tbl-btn tbl-btn-ghost tbl-btn-sm danger" disabled={!anySelected} onClick={() => handleDelete(selection.selectedItems)} title="削除 (Delete)">
            <i className="bi bi-trash" /> 削除{anySelected ? ` (${selectedCount})` : ""}
          </button>
        </div>
      </div>

      <SortBar sort={sort} columnLabels={columnLabels} />

      <DataList
        items={sort.sorted}
        columns={columns}
        getId={(c) => c.id}
        getNo={(c) => c.no ?? 0}
        onRowDelete={handleRowDelete}
        onContextMenu={handleContextMenu}
        selection={selection}
        clipboard={clipboard}
        sort={sort}
        onActivate={(c) => setActiveColId(c.id)}
        onReorder={handleReorder}
        showNumColumn
        variant="dark"
        className="columns-data-list"
        emptyMessage={<p>カラムがまだありません。テンプレートから追加するか、空のカラムを追加してください。</p>}
      />

      {detailCol && (
        <div className="column-detail">
          <div className="column-detail-header">
            <span className="column-detail-title">
              <i className="bi bi-pencil-square" /> 編集中: <code>{detailCol.physicalName}</code>
              <span className="column-detail-hint">(Esc で閉じる、外部キーは「制約」タブで管理)</span>
            </span>
            <button className="tbl-btn-icon" onClick={() => setActiveColId(null)} title="閉じる">
              <i className="bi bi-x-lg" />
            </button>
          </div>
          <ColumnDetailEditor
            col={detailCol}
            onUpdate={(patch) => handleUpdateCol(detailCol.id, patch)}
            showLength={DATA_TYPES_WITH_LENGTH.includes(detailCol.dataType as BuiltinDataType)}
            showScale={DATA_TYPES_WITH_SCALE.includes(detailCol.dataType as BuiltinDataType)}
          />
        </div>
      )}

      <div className="columns-add-bar">
        <button
          className="tbl-btn tbl-btn-primary"
          onClick={handleAddBlank}
          disabled={sortActive}
          title={sortActive ? "ソート中は無効 (ソート解除で利用可能)" : undefined}
        >
          <i className="bi bi-plus-lg" /> カラム追加
        </button>
        <button
          className={`tbl-btn tbl-btn-secondary${showTemplates ? " active" : ""}`}
          onClick={() => setShowTemplates(!showTemplates)}
          disabled={sortActive}
          title={sortActive ? "ソート中は無効 (ソート解除で利用可能)" : undefined}
        >
          <i className="bi bi-collection" /> テンプレートから追加
        </button>
      </div>

      {contextMenu && (
        <ListContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {showTemplates && (
        <div className="column-templates">
          <div className="column-templates-title">
            <i className="bi bi-collection" /> カラムテンプレート
            <button className="tbl-btn-icon" onClick={() => setShowTemplates(false)} title="閉じる">
              <i className="bi bi-x-lg" />
            </button>
          </div>
          <div className="column-templates-grid">
            {Object.entries(templateCategories).map(([cat, tpls]) => (
              <div key={cat} className="template-category">
                <div className="template-category-name">{cat}</div>
                <div className="template-items">
                  {tpls.map((tpl) => (
                    <button
                      key={tpl.id}
                      className="template-item"
                      onClick={() => handleAddFromTemplate(tpl)}
                      title={`${tpl.column.physicalName} (${tpl.column.dataType})`}
                    >
                      <i className={`bi ${tpl.icon}`} />
                      <span>{tpl.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── カラム詳細編集 (FK は ConstraintsTab で管理) ────────────────────────────

function ColumnDetailEditor({
  col, onUpdate, showLength, showScale,
}: {
  col: Column;
  onUpdate: (patch: Partial<Column>) => void;
  showLength: boolean;
  showScale: boolean;
}) {
  return (
    <div className="column-detail">
      <div className="column-detail-grid">
        <label className="tbl-field">
          <span>物理名</span>
          <input
            type="text"
            value={col.physicalName}
            onChange={(e) => onUpdate({ physicalName: e.target.value as PhysicalName })}
            placeholder="column_name"
          />
        </label>
        <label className="tbl-field">
          <span>表示名</span>
          <input
            type="text"
            value={col.name}
            onChange={(e) => onUpdate({ name: e.target.value as DisplayName })}
            placeholder="カラムの日本語名"
          />
        </label>
        <label className="tbl-field">
          <span>データ型</span>
          <select
            value={col.dataType}
            onChange={(e) => onUpdate({ dataType: e.target.value })}
          >
            {Object.entries(DATA_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        {showLength && (
          <label className="tbl-field">
            <span>長さ</span>
            <input
              type="number"
              value={col.length ?? ""}
              onChange={(e) => onUpdate({ length: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="255"
              min={1}
            />
          </label>
        )}
        {showScale && (
          <label className="tbl-field">
            <span>スケール</span>
            <input
              type="number"
              value={col.scale ?? ""}
              onChange={(e) => onUpdate({ scale: e.target.value ? Number(e.target.value) : undefined })}
              placeholder="2"
              min={0}
            />
          </label>
        )}
        <label className="tbl-field">
          <span>デフォルト値</span>
          <input
            type="text"
            value={col.defaultValue ?? ""}
            onChange={(e) => onUpdate({ defaultValue: e.target.value || undefined })}
            placeholder="NULL"
          />
        </label>
      </div>

      <div className="column-detail-flags">
        <label className="column-flag-label">
          <input type="checkbox" checked={col.notNull ?? false} onChange={(e) => onUpdate({ notNull: e.target.checked })} />
          NOT NULL
        </label>
        <label className="column-flag-label">
          <input
            type="checkbox"
            checked={col.primaryKey ?? false}
            onChange={(e) => onUpdate({ primaryKey: e.target.checked, notNull: e.target.checked ? true : col.notNull })}
          />
          PRIMARY KEY
        </label>
        <label className="column-flag-label">
          <input type="checkbox" checked={col.unique ?? false} onChange={(e) => onUpdate({ unique: e.target.checked })} />
          UNIQUE
        </label>
        <label className="column-flag-label">
          <input type="checkbox" checked={col.autoIncrement ?? false} onChange={(e) => onUpdate({ autoIncrement: e.target.checked })} />
          AUTO INCREMENT
        </label>
      </div>

      <div className="column-detail-extra">
        <label className="tbl-field">
          <span>備考</span>
          <input
            type="text"
            value={col.comment ?? ""}
            onChange={(e) => onUpdate({ comment: e.target.value || undefined })}
            placeholder="カラムの補足説明"
          />
        </label>

        <div className="column-fk-hint">
          <i className="bi bi-info-circle" /> 外部キー (FK) は「制約」タブで定義します。v3 では FK が Column ではなく Constraint に集約されました。
        </div>
      </div>
    </div>
  );
}

// ── コメントタブ ──────────────────────────────────────────────────────────────

function CommentTab({
  table, update,
}: {
  table: Table;
  update: (fn: (t: Table) => void) => void;
}) {
  return (
    <div className="comment-tab">
      <label className="tbl-field comment-tab-field">
        <span>テーブルコメント</span>
        <textarea
          className="comment-tab-textarea"
          value={table.comment ?? ""}
          onChange={(e) => update((t) => { t.comment = e.target.value || undefined; })}
          placeholder="テーブルの用途・概要を記載します（DDL の COMMENT ON TABLE に反映されます）"
          rows={4}
        />
      </label>
      <p className="comment-tab-hint">
        <i className="bi bi-info-circle" /> PostgreSQL では <code>COMMENT ON TABLE {table.physicalName} IS &#39;...&#39;;</code> として DDL に出力されます。
      </p>
    </div>
  );
}
