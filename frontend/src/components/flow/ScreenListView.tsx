import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type { ScreenNode } from "../../types/flow";
import { SCREEN_KIND_LABELS, SCREEN_KIND_ICONS } from "../../types/flow";
import type { ScreenId, ScreenKind, Timestamp } from "../../types/v3";
import { loadProject, loadRawProject, saveProject, addScreen, removeScreen, DEFAULT_NODE_SIZE } from "../../store/flowStore";
import { buildDefaultScreen, saveScreenEntity } from "../../store/screenStore";
import { resolveEditorKind } from "../../utils/resolveEditorKind";
import { resolveCssFramework } from "../../utils/resolveCssFramework";
import { mcpBridge } from "../../mcp/mcpBridge";
import { makeTabId } from "../../store/tabStore";
import { generateUUID } from "../../utils/uuid";
import { renumber } from "../../utils/listOrder";
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
import { ScreenEditModal, type ScreenFormData } from "./ScreenEditModal";
import { useDraftRegistry } from "../../hooks/useDraftRegistry";
import "../../styles/flow.css";
import "../../styles/screenList.css";
import "../../styles/editMode.css";

const STORAGE_KEY = "list-view-mode:screen-list";
const TAB_ID = makeTabId("screen-list", "main");

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function ScreenListView() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = usePersistentState<ViewMode>(STORAGE_KEY, "card");
  const [screenModal, setScreenModal] = useState<{ open: boolean; editId?: string; initial?: Partial<ScreenFormData> }>({ open: false });
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const { hasDraft } = useDraftRegistry();
  // project.techStack.designer の project default (画面作成ダイアログのデフォルト選択値)
  const [projectDefaultEditorKind, setProjectDefaultEditorKind] = useState<"grapesjs" | "puck">("grapesjs");
  const [projectDefaultCssFramework, setProjectDefaultCssFramework] = useState<"bootstrap" | "tailwind">("bootstrap");

  const loadScreens = useCallback(async (): Promise<ScreenNode[]> => {
    mcpBridge.startWithoutEditor();
    const [p, raw] = await Promise.all([loadProject(), loadRawProject()]);
    setProjectDefaultEditorKind(resolveEditorKind(undefined, raw.techStack));
    setProjectDefaultCssFramework(resolveCssFramework(undefined, raw.techStack));
    return p.screens;
  }, []);

  const commitScreens = useCallback(async ({ itemsInOrder, deletedIds }: { itemsInOrder: ScreenNode[]; deletedIds: string[] }) => {
    const project = await loadProject();
    // 削除: removeScreen はデザインデータも削除 + edges 掃除
    for (const id of deletedIds) {
      await removeScreen(project, id);
    }
    // 並び順反映
    const deletedSet = new Set(deletedIds);
    const orderMap = new Map(itemsInOrder.map((s, i) => [s.id, i]));
    project.screens = project.screens
      .filter((s) => !deletedSet.has(s.id))
      .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
    await saveProject(project);
  }, []);

  const editor = useListEditor<ScreenNode>({
    getId: (s) => s.id,
    load: loadScreens,
    commit: commitScreens,
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

  const screens = editor.items;

  const filter = useListFilter(screens);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      filter.applyFilter(null);
      return;
    }
    filter.applyFilter((s) =>
      s.name.toLowerCase().includes(q) ||
      (s.path || "").toLowerCase().includes(q) ||
      (SCREEN_KIND_LABELS[s.kind] || "").toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const sortAccessor = useCallback((s: ScreenNode, key: string): string | number => {
    switch (key) {
      case "name": return s.name;
      case "type": return SCREEN_KIND_LABELS[s.kind] ?? "";
      case "path": return s.path ?? "";
      case "hasDesign": return s.hasDesign ? 1 : 0;
      case "updatedAt": return s.updatedAt;
      default: return "";
    }
  }, []);

  const sort = useListSort(filter.filtered, sortAccessor);
  const selection = useListSelection(sort.sorted, (s) => s.id);
  const clipboard = useListClipboard<ScreenNode>((s) => s.id);

  const handleActivate = useCallback((s: ScreenNode) => {
    if (editor.isDeleted(s.id)) return;
    navigate(`/screen/design/${s.id}`);
  }, [navigate, editor]);

  const handleDelete = (items: ScreenNode[]) => {
    editor.markDeleted(items.map((s) => s.id));
  };

  const handleReorder = (fromIdx: number, toIdx: number) => {
    // docs/spec/list-common.md §3.9: ソート中は DataList 側で D&D が無効化される
    const visible = sort.sorted;
    const fromId = visible[fromIdx]?.id;
    const toId = visible[toIdx]?.id;
    if (!fromId || !toId) return;
    const realFrom = editor.items.findIndex((s) => s.id === fromId);
    const realTo = editor.items.findIndex((s) => s.id === toId);
    if (realFrom < 0 || realTo < 0) return;
    editor.reorder(realFrom, realTo);
  };

  const moveBlock = (items: ScreenNode[], direction: "up" | "down") => {
    // docs/spec/list-common.md §3.9: ソート中は useListKeyboard 側で Alt+↑↓ が無効化される
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

  const duplicateScreen = async (src: ScreenNode): Promise<string | null> => {
    const project = await loadProject();
    const s = project.screens.find((sc) => sc.id === src.id);
    if (!s) return null;
    const dup: ScreenNode = {
      ...s,
      id: generateUUID() as ScreenId,
      // no は renumber() で振り直されるため、...s 由来の値のままで良い (即上書き)
      name: s.name + " (コピー)",
      position: { x: s.position.x + 40, y: s.position.y + 40 },
      size: { ...DEFAULT_NODE_SIZE },
      hasDesign: false,
      thumbnail: undefined,
      createdAt: new Date().toISOString() as Timestamp,
      updatedAt: new Date().toISOString() as Timestamp,
    };
    project.screens.push(dup);
    project.screens = renumber(project.screens);
    await saveProject(project);
    return dup.id;
  };

  const handleDuplicate = async (items: ScreenNode[]) => {
    const newIds: string[] = [];
    for (const s of items) {
      const id = await duplicateScreen(s);
      if (id) newIds.push(id);
    }
    await editor.reload();
    if (newIds.length > 0) selection.setSelectedIds(new Set(newIds));
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

      // docs/spec/list-common.md §3.9: ソート中は useListKeyboard 側で Ctrl+V が無効化される
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
      selection.setSelectedIds(new Set(moved.map((s) => s.id)));
    } else {
      const newIds: string[] = [];
      for (const s of clipItems) {
        const id = await duplicateScreen(s);
        if (id) newIds.push(id);
      }
      clipboard.consume();
      await editor.reload();
      selection.setSelectedIds(new Set(newIds));
    }
  };

  const sortActive = sort.sortKeys.length > 0;

  const columnLabels = useMemo<Record<string, string>>(() => ({
    name: "画面名",
    type: "種別",
    path: "URL",
    hasDesign: "デザイン",
    updatedAt: "更新日時",
  }), []);

  const handleAddNew = () => {
    setScreenModal({ open: true });
  };

  // docs/spec/list-common.md §3.11: 右クリックメニュー項目を構築
  const buildMenuItems = (target: ScreenNode | null): ContextMenuItem[] => {
    const hasSelection = selection.selectedIds.size > 0 || target !== null;
    const pasteBlocked = sortActive || !clipboard.hasContent;
    const pasteReason = sortActive ? "ソート中は無効 (ソート解除で利用可能)" : "クリップボードが空";
    const sortReason = "ソート中は無効 (ソート解除で利用可能)";

    // 空領域の右クリック: 「新規作成」のみの絞り込みメニュー
    if (target === null && selection.selectedIds.size === 0) {
      return [
        {
          key: "new", label: "新規作成", icon: "bi-plus-lg",
          disabled: sortActive, disabledReason: sortReason,
          onClick: handleAddNew,
        },
      ];
    }

    const items = target && !selection.isSelected(target.id)
      ? [target]
      : selection.selectedItems;

    return [
      {
        key: "new", label: "新規作成", icon: "bi-plus-lg", shortcut: "",
        disabled: sortActive, disabledReason: sortReason,
        onClick: handleAddNew,
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
          const allIds: string[] = editor.items.map((s) => s.id as string);
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

  const handleContextMenu = (e: React.MouseEvent, target: ScreenNode | null) => {
    setContextMenu({ x: e.clientX, y: e.clientY, items: buildMenuItems(target) });
  };

  const handleContextMenuKey = (first: ScreenNode | null, rect: DOMRect | null) => {
    // 右クリックと同様、対象行が未選択なら単独選択に切り替える (Windows エクスプローラ流)
    if (first && !selection.isSelected(first.id)) {
      selection.setSelectedIds(new Set([first.id]));
    }
    const x = rect ? rect.left : 100;
    const y = rect ? rect.bottom : 100;
    setContextMenu({ x, y, items: buildMenuItems(first) });
  };

  const handleRowDelete = (s: ScreenNode) => {
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

  const handleScreenSave = async (data: ScreenFormData) => {
    const project = await loadProject();
    if (screenModal.editId) {
      const s = project.screens.find((sc) => sc.id === screenModal.editId);
      if (s) {
        s.name = data.name;
        s.kind = data.type as ScreenKind;
        s.path = data.path;
        s.description = data.description;
        s.updatedAt = new Date().toISOString() as Timestamp;
        await saveProject(project);
      }
    } else {
      const editorKind = data.editorKind ?? projectDefaultEditorKind;
      const cssFramework = data.cssFramework ?? projectDefaultCssFramework;
      const screen = await addScreen(project, data.name, data.type as ScreenKind, { path: data.path, editorKind, cssFramework });
      screen.description = data.description;
      await saveProject(project);
      // screen.design に editorKind/cssFramework を明示書き込み (spec § 2.5.2)
      const entity = await buildDefaultScreen(screen.id);
      entity.design = { ...entity.design, editorKind, cssFramework };
      await saveScreenEntity(entity);
    }
    setScreenModal({ open: false });
    await editor.reload();
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

  const columns = useMemo<DataListColumn<ScreenNode>[]>(() => [
    {
      key: "draft",
      header: "",
      width: "32px",
      align: "center",
      render: (s) => hasDraft("screen", s.id)
        ? <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
        : null,
    },
    {
      key: "name",
      header: "画面名",
      sortable: true,
      sortAccessor: (s) => s.name,
      render: (s) => (
        <span className="screen-table-name">
          <i className={`bi ${SCREEN_KIND_ICONS[s.kind] ?? "bi-circle"} screen-table-icon`} />
          {s.name}
        </span>
      ),
    },
    {
      key: "type",
      header: "種別",
      width: "120px",
      sortable: true,
      sortAccessor: (s) => SCREEN_KIND_LABELS[s.kind] ?? "",
      render: (s) => <span className="screen-type-badge">{SCREEN_KIND_LABELS[s.kind] ?? s.kind}</span>,
    },
    {
      key: "path",
      header: "URL",
      sortable: true,
      sortAccessor: (s) => s.path ?? "",
      render: (s) => s.path || <span className="screen-table-empty-cell">—</span>,
    },
    {
      key: "hasDesign",
      header: "デザイン",
      width: "130px",
      sortable: true,
      sortAccessor: (s) => (s.hasDesign ? 1 : 0),
      render: (s) => (
        <span className={`screen-design-badge${s.hasDesign ? "" : " empty"}`}>
          <i className={`bi ${s.hasDesign ? "bi-brush-fill" : "bi-brush"}`} />
          {s.hasDesign ? "デザイン済" : "未デザイン"}
        </span>
      ),
    },
    {
      key: "updatedAt",
      header: "更新日時",
      width: "160px",
      sortable: true,
      sortAccessor: (s) => s.updatedAt,
      render: (s) => <span className="screen-table-date">{formatDate(s.updatedAt)}</span>,
    },
    {
      key: "screenItems",
      header: "項目定義",
      width: "100px",
      align: "center",
      render: (s) => (
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={(e) => { e.stopPropagation(); navigate(wsPath(`/screen/items/${s.id}`)); }}
          title="画面項目定義を開く"
          aria-label={`${s.name} の画面項目定義を開く`}
        >
          <i className="bi bi-ui-checks-grid" />
          {hasDraft("screen-item", s.id) && (
            <span className="list-item-draft-mark ms-1" title="未保存の編集中 draft があります">●</span>
          )}
        </button>
      ),
    },
  ], [hasDraft, navigate, wsPath]);

  const renderCard = (s: ScreenNode) => (
    <div className="screen-card-content">
      <div className="screen-card-head">
        <i className={`bi ${SCREEN_KIND_ICONS[s.kind] ?? "bi-circle"} screen-card-icon`} />
        <span className="screen-card-name">{s.name}</span>
        <span className="screen-type-badge">{SCREEN_KIND_LABELS[s.kind] ?? s.kind}</span>
        {hasDraft("screen", s.id) && (
          <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
        )}
      </div>
      {s.path && <div className="screen-card-path">{s.path}</div>}
      <div className="screen-card-meta">
        <span className={`screen-design-badge${s.hasDesign ? "" : " empty"}`}>
          <i className={`bi ${s.hasDesign ? "bi-brush-fill" : "bi-brush"}`} />
          {s.hasDesign ? "デザイン済" : "未デザイン"}
        </span>
        <span className="screen-card-date">{formatDate(s.updatedAt)}</span>
      </div>
      <div className="screen-card-actions">
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary"
          onClick={(e) => { e.stopPropagation(); navigate(wsPath(`/screen/items/${s.id}`)); }}
          title="画面項目定義を開く"
        >
          <i className="bi bi-ui-checks-grid me-1" />
          項目定義
          {hasDraft("screen-item", s.id) && (
            <span className="list-item-draft-mark ms-1" title="未保存の編集中 draft があります">●</span>
          )}
        </button>
      </div>
    </div>
  );

  const deletedCount = editor.deletedIds.size;

  return (
    <div className="screen-list-page">
      <div className="screen-list-header">
        <h2 className="screen-list-title">
          <i className="bi bi-list-ul" /> 画面一覧
          <span className="screen-list-count">
            {screens.length - deletedCount} 画面{deletedCount > 0 ? ` (削除予定 ${deletedCount})` : ""}
          </span>
        </h2>
        <div className="screen-list-header-tools">
          <div className="screen-list-search">
            <i className="bi bi-search" />
            <input
              type="text"
              placeholder="画面名・URL・種別で絞り込み..."
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
            className="flow-btn flow-btn-primary"
            onClick={handleAddNew}
            disabled={sortActive}
            title={sortActive ? "ソート中は無効 (ソート解除で利用可能)" : undefined}
          >
            <i className="bi bi-plus-lg" /> 画面を追加
          </button>
          <button
            className="flow-btn flow-btn-ghost danger"
            onClick={() => handleDelete(selection.selectedItems)}
            disabled={selection.selectedIds.size === 0}
            title="削除 (Delete)"
          >
            <i className="bi bi-trash" /> 削除{selection.selectedIds.size > 0 ? ` (${selection.selectedIds.size})` : ""}
          </button>
          <span className="screen-list-saveline-sep" />
          <button
            className="flow-btn flow-btn-ghost"
            data-testid="list-reset-btn"
            onClick={handleReset}
            disabled={!editor.isDirty || editor.isSaving}
            title="変更を破棄"
          >
            <i className="bi bi-arrow-counterclockwise" /> リセット
          </button>
          <button
            className="flow-btn flow-btn-primary"
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

      <div className="screen-list-body">
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
          isItemGhost={(id) => editor.isDeleted(id)}
          emptyMessage={
            query
              ? <p>該当する画面がありません</p>
              : <p>画面がまだありません。「画面を追加」から作成してください。</p>
          }
        />
      </div>

      <ScreenEditModal
        open={screenModal.open}
        initial={screenModal.initial}
        title={screenModal.editId ? "画面の編集" : "画面の追加"}
        isCreate={!screenModal.editId}
        defaultEditorKind={projectDefaultEditorKind}
        defaultCssFramework={projectDefaultCssFramework}
        onSave={(data) => { handleScreenSave(data).catch(console.error); }}
        onClose={() => setScreenModal({ open: false })}
      />

      {contextMenu && (
        <ListContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
