import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { Sequence, SequenceEntry, SequenceId, PhysicalName, DisplayName, Timestamp } from "../../types/v3";
import { listSequences, createSequence, loadSequence, saveSequence, commitSequences } from "../../store/sequenceStore";
import { generateUUID } from "../../utils/uuid";
import { loadProject } from "../../store/flowStore";
import { mcpBridge } from "../../mcp/mcpBridge";
import { makeTabId } from "../../store/tabStore";
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
import { renumber } from "../../utils/listOrder";
import { useDraftRegistry } from "../../hooks/useDraftRegistry";
import "../../styles/editMode.css";

const STORAGE_KEY = "list-view-mode:sequence-list";
const TAB_ID = makeTabId("sequence-list", "main");

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ja-JP");
  } catch {
    return iso;
  }
}

export function SequenceListView() {
  const navigate = useNavigate();
  const { hasDraft } = useDraftRegistry();
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = usePersistentState<ViewMode>(STORAGE_KEY, "card");
  const [showAdd, setShowAdd] = useState(false);
  const [addPhysicalName, setAddPhysicalName] = useState("");
  const [addName, setAddName] = useState("");
  const [addPhysicalNameError, setAddPhysicalNameError] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const loadSequences = useCallback(async () => {
    mcpBridge.startWithoutEditor();
    await loadProject();
    return await listSequences();
  }, []);

  const editor = useListEditor<SequenceEntry>({
    getId: (s) => s.id,
    load: loadSequences,
    commit: commitSequences,
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
    const unsubSeq = mcpBridge.onBroadcast("sequenceChanged", () => {
      if (!editor.isDirty) editor.reload();
    });
    return () => { unsubStatus(); unsubProj(); unsubSeq(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allSequences = editor.items;

  const filter = useListFilter(allSequences);
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      filter.applyFilter(null);
      return;
    }
    filter.applyFilter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.physicalName ?? "").toLowerCase().includes(q) ||
      (s.conventionRef ?? "").toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const sortAccessor = useCallback((s: SequenceEntry, key: string): string | number => {
    switch (key) {
      case "name": return s.name;
      case "physicalName": return s.physicalName ?? "";
      case "conventionRef": return s.conventionRef ?? "";
      case "updatedAt": return s.updatedAt;
      default: return "";
    }
  }, []);

  const sort = useListSort(filter.filtered, sortAccessor);
  const selection = useListSelection(sort.sorted, (s) => s.id);
  const clipboard = useListClipboard<SequenceEntry>((s) => s.id);

  const handleActivate = useCallback((s: SequenceEntry) => {
    if (editor.isDeleted(s.id)) return;
    navigate(`/sequence/edit/${encodeURIComponent(s.id)}`);
  }, [navigate, editor]);

  const handleDelete = (items: SequenceEntry[]) => {
    editor.markDeleted(items.map((s) => s.id));
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

  const handleDuplicate = async (items: SequenceEntry[]) => {
    const newIds: string[] = [];
    const existingPhysical = new Set<string>(editor.items.map((s) => s.physicalName ?? ""));
    for (const m of items) {
      const full = await loadSequence(m.id);
      if (!full) continue;
      const newPhysical = makeCopyPhysicalName(full.physicalName ?? full.name, existingPhysical);
      existingPhysical.add(newPhysical);
      const ts = new Date().toISOString() as Timestamp;
      const newId = generateUUID() as SequenceId;
      const completed: Sequence = {
        ...full,
        id: newId,
        physicalName: newPhysical as PhysicalName,
        createdAt: ts,
        updatedAt: ts,
      };
      await saveSequence(completed);
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
      const removedBefore = editor.items.slice(0, pos0).filter((s) => cutIds.has(s.id)).length;
      const remaining = editor.items.filter((s) => !cutIds.has(s.id));
      const pos = Math.min(remaining.length, pos0 - removedBefore);
      editor.setItems(() => {
        const next = [...remaining];
        next.splice(pos, 0, ...moved);
        return renumber(next);
      });
      selection.setSelectedIds(new Set<string>(moved.map((s) => s.id)));
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
    const realFrom = editor.items.findIndex((s) => s.id === fromId);
    const realTo = editor.items.findIndex((s) => s.id === toId);
    if (realFrom < 0 || realTo < 0) return;
    editor.reorder(realFrom, realTo);
  };

  const moveBlock = (items: SequenceEntry[], direction: "up" | "down") => {
    const ids = new Set(items.map((s) => s.id));
    const idxs = editor.items
      .map((s, i) => (ids.has(s.id) ? i : -1))
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
    conventionRef: "規約参照",
    updatedAt: "更新日",
  }), []);

  const handleAdd = async () => {
    const physical = addPhysicalName.trim();
    const name = addName.trim();
    if (!physical || !name) return;
    if (editor.items.some((s) => s.physicalName === physical)) {
      setAddPhysicalNameError(`物理名 "${physical}" は既に存在します`);
      return;
    }
    const seq = await createSequence(physical as PhysicalName, name as DisplayName);
    setShowAdd(false);
    setAddPhysicalName("");
    setAddName("");
    setAddPhysicalNameError("");
    navigate(`/sequence/edit/${encodeURIComponent(seq.id)}`);
  };

  const buildMenuItems = (target: SequenceEntry | null): ContextMenuItem[] => {
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
          const allIds: string[] = editor.items.map((s) => s.id);
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

  const handleContextMenu = (e: React.MouseEvent, target: SequenceEntry | null) => {
    setContextMenu({ x: e.clientX, y: e.clientY, items: buildMenuItems(target) });
  };

  const handleContextMenuKey = (first: SequenceEntry | null, rect: DOMRect | null) => {
    if (first && !selection.isSelected(first.id)) {
      selection.setSelectedIds(new Set<string>([first.id]));
    }
    const x = rect ? rect.left : 100;
    const y = rect ? rect.bottom : 100;
    setContextMenu({ x, y, items: buildMenuItems(first) });
  };

  const handleRowDelete = (s: SequenceEntry) => {
    handleDelete([s]);
  };

  useListKeyboard({
    items: sort.sorted,
    getId: (s) => s.id,
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

  const columns = useMemo<DataListColumn<SequenceEntry>[]>(() => [
    {
      key: "draft",
      header: "",
      width: "32px",
      align: "center",
      render: (s) => hasDraft("sequence", s.id)
        ? <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
        : null,
    },
    {
      key: "name",
      header: "表示名",
      sortable: true,
      sortAccessor: (s) => s.name,
      render: (s) => <span>{s.name}</span>,
    },
    {
      key: "physicalName",
      header: "物理名",
      sortable: true,
      sortAccessor: (s) => s.physicalName ?? "",
      render: (s) => s.physicalName
        ? <code className="seq-list-name-code">{s.physicalName}</code>
        : null,
    },
    {
      key: "conventionRef",
      header: "規約参照",
      sortable: true,
      sortAccessor: (s) => s.conventionRef ?? "",
      render: (s) => s.conventionRef
        ? <span className="seq-list-conv-ref">{s.conventionRef}</span>
        : null,
    },
    {
      key: "updatedAt",
      header: "更新日",
      width: "120px",
      sortable: true,
      sortAccessor: (s) => s.updatedAt,
      render: (s) => <span className="seq-list-date">{formatDate(s.updatedAt)}</span>,
    },
  ], [hasDraft]);

  const renderCard = (s: SequenceEntry) => (
    <div className="seq-card-content">
      <div className="seq-card-header">
        <span className="seq-card-name">{s.name}</span>
        {hasDraft("sequence", s.id) && (
          <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
        )}
      </div>
      {s.physicalName && (
        <div className="seq-card-description"><code>{s.physicalName}</code></div>
      )}
      {s.conventionRef && (
        <div className="seq-card-conv-ref">
          <i className="bi bi-link-45deg" /> {s.conventionRef}
        </div>
      )}
      <div className="seq-card-meta">
        <span className="seq-card-date">{formatDate(s.updatedAt)}</span>
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
            <i className="bi bi-arrow-repeat" /> シーケンス定義
            <span className="table-list-count">
              {allSequences.length - deletedCount} 件{deletedCount > 0 ? ` (削除予定 ${deletedCount})` : ""}
            </span>
          </h2>
          <div className="table-list-actions">
            <div className="table-list-search">
              <i className="bi bi-search" />
              <input
                type="text"
                placeholder="表示名・物理名・規約参照で絞り込み..."
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
              <i className="bi bi-plus-lg" /> シーケンス追加
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
          getId={(s) => s.id}
          getNo={(s) => s.no}
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
          className="sequences-data-list"
          isItemGhost={(id) => editor.isDeleted(id)}
          emptyMessage={
            query
              ? <p>該当するシーケンス定義がありません</p>
              : <p>シーケンス定義がまだありません。「シーケンス追加」から作成してください。</p>
          }
        />

        {showAdd && (
          <div className="tbl-modal-overlay" onClick={() => { setShowAdd(false); setAddPhysicalNameError(""); }}>
            <div className="tbl-modal" onClick={(e) => e.stopPropagation()}>
              <div className="tbl-modal-title">シーケンス追加</div>
              <label className="tbl-field">
                <span>物理名 <small>(snake_case、例: po_number_seq)</small></span>
                <input
                  type="text"
                  value={addPhysicalName}
                  onChange={(e) => { setAddPhysicalName(e.target.value); setAddPhysicalNameError(""); }}
                  placeholder="po_number_seq"
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
                  placeholder="発注番号採番"
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
