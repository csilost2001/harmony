/**
 * GadgetListView — ガジェット一覧 (pl-4, #1025)
 *
 * purpose='gadget' の Screen 一覧。ScreenListView.tsx を参考に実装。
 * - DataList (list-common.md 準拠) でカード ⇔ 表形式切替
 * - 使用先 PageLayout 数 (逆参照) を表示
 * - 「新規ガジェット作成」ボタン → modal で作成 (purpose: "gadget" 固定)
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type { ScreenNode } from "../../types/flow";
import { SCREEN_KIND_LABELS, SCREEN_KIND_ICONS } from "../../types/flow";
import type { ScreenKind } from "../../types/v3";
import { loadProject, loadRawProject, saveProject, addScreen, removeScreen } from "../../store/flowStore";
import { buildDefaultScreen, saveScreenEntity } from "../../store/screenStore";
import { resolveCssFramework } from "../../utils/resolveCssFramework";
import { resolveEditorKind } from "../../utils/resolveEditorKind";
import { mcpBridge } from "../../mcp/mcpBridge";
import { makeTabId } from "../../store/tabStore";
import { renumber } from "../../utils/listOrder";
import { listPageLayouts, loadPageLayout } from "../../store/pageLayoutStore";
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
import "../../styles/flow.css";
import "../../styles/screenList.css";
import "../../styles/editMode.css";

const STORAGE_KEY = "list-view-mode:gadget-list";
const TAB_ID = makeTabId("gadget-list", "main");

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

export function GadgetListView() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = usePersistentState<ViewMode>(STORAGE_KEY, "card");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  // RFC #1021 pl-6 (Codex C-3 / H-4): gadget Screen → 使用先 PageLayout 数の逆参照 map
  // assignments は PageLayoutEntry に含まれていないため各 PageLayout を full load して計算
  const [usageMap, setUsageMap] = useState<Map<string, number>>(new Map());
  const [projectDefaultEditorKind, setProjectDefaultEditorKind] = useState<"grapesjs" | "puck">("grapesjs");
  const [projectDefaultCssFramework, setProjectDefaultCssFramework] = useState<"bootstrap" | "tailwind">("bootstrap");

  // 新規作成モーダル
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addKind, setAddKind] = useState<ScreenKind>("other");
  const [addNameError, setAddNameError] = useState("");

  // purpose='gadget' の Screen のみをロード
  const loadGadgets = useCallback(async (): Promise<ScreenNode[]> => {
    mcpBridge.startWithoutEditor();
    const [p, raw] = await Promise.all([loadProject(), loadRawProject()]);
    setProjectDefaultEditorKind(resolveEditorKind(undefined, raw.techStack));
    setProjectDefaultCssFramework(resolveCssFramework(undefined, raw.techStack));
    return p.screens.filter((s) => s.purpose === "gadget");
  }, []);

  const commitGadgets = useCallback(async ({ itemsInOrder, deletedIds }: { itemsInOrder: ScreenNode[]; deletedIds: string[] }) => {
    const project = await loadProject();
    for (const id of deletedIds) {
      await removeScreen(project, id);
    }
    const deletedSet = new Set(deletedIds);
    const orderMap = new Map(itemsInOrder.map((s, i) => [s.id, i]));
    // gadget 以外の Screen は順序を維持しつつ gadget の並び替えのみ反映
    const nonGadgets = project.screens.filter((s) => s.purpose !== "gadget" && !deletedSet.has(s.id));
    const gadgetScreens = project.screens
      .filter((s) => s.purpose === "gadget" && !deletedSet.has(s.id))
      .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
    project.screens = renumber([...nonGadgets, ...gadgetScreens]);
    await saveProject(project);
  }, []);

  const editor = useListEditor<ScreenNode>({
    getId: (s) => s.id,
    load: loadGadgets,
    commit: commitGadgets,
    tabId: TAB_ID,
    renumber,
  });

  // PageLayout 一覧をロード (逆参照カウント用)
  // RFC #1021 pl-6 (Codex C-3 / H-4 + C-5): pageLayoutChanged broadcast にも対応し、
  // 別タブで PageLayout が増減した場合 / assignments が変わった場合に再計算する
  useEffect(() => {
    let mounted = true;
    const loadAll = async () => {
      try {
        const entries = await listPageLayouts();
        if (!mounted) return;
        // 各 PageLayout を full load して assignments → gadget の逆参照 map を構築
        const next = new Map<string, number>();
        const fullLoads = await Promise.all(
          entries.map((e) => loadPageLayout(e.id).catch(() => null)),
        );
        for (const pl of fullLoads) {
          if (!pl?.assignments) continue;
          for (const screenId of Object.values(pl.assignments)) {
            if (typeof screenId !== "string") continue;
            next.set(screenId, (next.get(screenId) ?? 0) + 1);
          }
        }
        if (mounted) setUsageMap(next);
      } catch (e) { console.error("[GadgetListView] PageLayout usage 再計算失敗:", e); }
    };
    loadAll();
    const unsubBroadcast = mcpBridge.onBroadcast("pageLayoutChanged", () => loadAll());
    return () => { mounted = false; unsubBroadcast(); };
  }, []);

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

  const gadgets = editor.items;

  // 各ガジェットを参照している PageLayout 数 (RFC #1021 pl-6 Codex C-3/H-4 解消版)
  // 計算は useEffect 側で行い setUsageMap に格納。ここでは alias 公開のみ。
  const pageLayoutUsageMap = usageMap;

  const filter = useListFilter(gadgets);

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      filter.applyFilter(null);
      return;
    }
    filter.applyFilter((s) =>
      s.name.toLowerCase().includes(q) ||
      (SCREEN_KIND_LABELS[s.kind] || "").toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const sortAccessor = useCallback((s: ScreenNode, key: string): string | number => {
    switch (key) {
      case "name": return s.name;
      case "type": return SCREEN_KIND_LABELS[s.kind] ?? "";
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
    navigate(wsPath(`/screen/design/${s.id}`));
  }, [navigate, editor, wsPath]);

  const handleDelete = (items: ScreenNode[]) => {
    editor.markDeleted(items.map((s) => s.id));
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

  const moveBlock = (items: ScreenNode[], direction: "up" | "down") => {
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
    name: "ガジェット名",
    type: "種別",
    hasDesign: "デザイン",
    updatedAt: "更新日時",
  }), []);

  const handleAddNew = () => {
    setAddName("");
    setAddKind("other");
    setAddNameError("");
    setShowAdd(true);
  };

  const handleAddSave = async () => {
    const name = addName.trim();
    if (!name) {
      setAddNameError("ガジェット名を入力してください");
      return;
    }
    const project = await loadProject();
    const editorKind = projectDefaultEditorKind;
    const cssFramework = projectDefaultCssFramework;
    const screen = await addScreen(project, name, addKind, {
      purpose: "gadget",
      editorKind,
      cssFramework,
    });
    await saveProject(project);
    const entity = await buildDefaultScreen(screen.id);
    entity.design = { ...entity.design, editorKind, cssFramework };
    await saveScreenEntity(entity);
    setShowAdd(false);
    await editor.reload();
    selection.setSelectedIds(new Set([screen.id]));
  };

  const buildMenuItems = (target: ScreenNode | null): ContextMenuItem[] => {
    const hasSelection = selection.selectedIds.size > 0 || target !== null;
    const sortReason = "ソート中は無効 (ソート解除で利用可能)";

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
        key: "new", label: "新規作成", icon: "bi-plus-lg",
        disabled: sortActive, disabledReason: sortReason,
        onClick: handleAddNew,
      },
      { key: "sep1", separator: true },
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
    onMoveUp: (items) => moveBlock(items, "up"),
    onMoveDown: (items) => moveBlock(items, "down"),
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

  const columns = useMemo<DataListColumn<ScreenNode>[]>(() => [
    {
      key: "name",
      header: "ガジェット名",
      sortable: true,
      sortAccessor: (s) => s.name,
      render: (s) => (
        <span className="screen-table-name">
          <i className={`bi ${SCREEN_KIND_ICONS[s.kind] ?? "bi-puzzle"} screen-table-icon`} />
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
      key: "pageLayoutUsage",
      header: "使用先 PL",
      width: "100px",
      align: "center",
      render: (s) => {
        const count = pageLayoutUsageMap.get(s.id) ?? 0;
        return <span className="screen-table-date">{count} 件</span>;
      },
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
        </button>
      ),
    },
  ], [navigate, wsPath, pageLayoutUsageMap]);

  const renderCard = (s: ScreenNode) => (
    <div className="screen-card-content">
      <div className="screen-card-head">
        <i className={`bi ${SCREEN_KIND_ICONS[s.kind] ?? "bi-puzzle"} screen-card-icon`} />
        <span className="screen-card-name">{s.name}</span>
        <span className="screen-type-badge">{SCREEN_KIND_LABELS[s.kind] ?? s.kind}</span>
      </div>
      <div className="screen-card-meta">
        <span className={`screen-design-badge${s.hasDesign ? "" : " empty"}`}>
          <i className={`bi ${s.hasDesign ? "bi-brush-fill" : "bi-brush"}`} />
          {s.hasDesign ? "デザイン済" : "未デザイン"}
        </span>
        <span className="screen-card-date">
          使用先 {pageLayoutUsageMap.get(s.id) ?? 0} PL
        </span>
      </div>
      <div className="screen-card-meta">
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
        </button>
      </div>
    </div>
  );

  const deletedCount = editor.deletedIds.size;

  return (
    <div className="screen-list-page">
      <div className="screen-list-header">
        <h2 className="screen-list-title">
          <i className="bi bi-puzzle" /> ガジェット一覧
          <span className="screen-list-count">
            {gadgets.length - deletedCount} 件{deletedCount > 0 ? ` (削除予定 ${deletedCount})` : ""}
          </span>
        </h2>
        <div className="screen-list-header-tools">
          <div className="screen-list-search">
            <i className="bi bi-search" />
            <input
              type="text"
              placeholder="ガジェット名・種別で絞り込み..."
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
            <i className="bi bi-plus-lg" /> ガジェットを追加
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
              ? <p>該当するガジェットがありません</p>
              : <p>ガジェットがまだありません。「ガジェットを追加」から作成してください。</p>
          }
        />
      </div>

      {/* 新規ガジェット作成モーダル */}
      {showAdd && (
        <div className="modal fade show" style={{ display: "block", backgroundColor: "rgba(0,0,0,0.5)" }} role="dialog">
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-puzzle me-2" />ガジェットを追加
                </h5>
                <button type="button" className="btn-close" onClick={() => setShowAdd(false)} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label fw-semibold">ガジェット名 <span className="text-danger">*</span></label>
                  <input
                    type="text"
                    className={`form-control${addNameError ? " is-invalid" : ""}`}
                    value={addName}
                    onChange={(e) => { setAddName(e.target.value); if (addNameError) setAddNameError(""); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleAddSave().catch(console.error); }}
                    placeholder="例: ヘッダー、フッター、サイドバー"
                    autoFocus
                  />
                  {addNameError && <div className="invalid-feedback">{addNameError}</div>}
                </div>
                <div className="mb-3">
                  <label className="form-label fw-semibold">種別</label>
                  <select
                    className="form-select"
                    value={addKind}
                    onChange={(e) => setAddKind(e.target.value as ScreenKind)}
                  >
                    {Object.entries(SCREEN_KIND_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                  <div className="form-text">ガジェットは URL を持たないため「その他」を推奨します</div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowAdd(false)}>
                  キャンセル
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => handleAddSave().catch(console.error)}
                  disabled={!addName.trim()}
                >
                  <i className="bi bi-plus-lg me-1" />作成
                </button>
              </div>
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
  );
}
