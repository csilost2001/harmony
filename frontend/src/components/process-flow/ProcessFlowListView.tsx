// @ts-nocheck
import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { ProcessFlowMeta, ProcessFlowType, ProcessFlow } from "../../types/action";
import { PROCESS_FLOW_TYPE_LABELS, PROCESS_FLOW_TYPE_ICONS } from "../../types/action";
import {
  listProcessFlows,
  loadProcessFlow,
  saveProcessFlow,
  createProcessFlow,
  deleteProcessFlow,
} from "../../store/processFlowStore";
import { loadProject, saveProject } from "../../store/flowStore";
import { aggregateValidation } from "../../utils/aggregatedValidation";
import type { TableDefinition as ValidatorTableDef } from "../../schemas/sqlColumnValidator";
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";
import { loadConventions } from "../../store/conventionsStore";
import { listTables, loadTable } from "../../store/tableStore";
import { mcpBridge } from "../../mcp/mcpBridge";
import { makeTabId } from "../../store/tabStore";
import { TableSubToolbar } from "../table/TableSubToolbar";
import { DataList, type DataListColumn } from "../common/DataList";
import { FilterBar } from "../common/FilterBar";
import { SortBar } from "../common/SortBar";
import { ListContextMenu, type ContextMenuItem } from "../common/ListContextMenu";
import { ViewModeToggle, type ViewMode } from "../common/ViewModeToggle";
import { ValidationBadge } from "../common/ValidationBadge";
import { MaturityBadge } from "./MaturityBadge";
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
import "../../styles/processFlow.css";
import "../../styles/editMode.css";

const ALL_TYPES: ProcessFlowType[] = ["screen", "batch", "scheduled", "system", "common", "other"];
const STORAGE_KEY = "list-view-mode:process-flow-list";
const TAB_ID = makeTabId("process-flow-list", "main");

interface ValidationSummary {
  errors: number;
  warnings: number;
}

interface MarkerSummary {
  todo: number;
  question: number;
  attention: number;
  chat: number;
  total: number;
}

const MARKER_BADGE_META: Array<{ kind: "todo" | "question" | "attention" | "chat"; icon: string; label: string }> = [
  { kind: "todo", icon: "bi-robot", label: "AI 依頼" },
  { kind: "question", icon: "bi-question-circle-fill", label: "質問" },
  { kind: "attention", icon: "bi-exclamation-triangle-fill", label: "注意" },
  { kind: "chat", icon: "bi-chat-dots-fill", label: "メモ" },
];

export function ProcessFlowListView() {
  const navigate = useNavigate();
  const { hasDraft } = useDraftRegistry();
  const [filterType, setFilterType] = useState<ProcessFlowType | "all">("all");
  const [filterErrorsOnly, setFilterErrorsOnly] = useState(false);
  const [filterMarkersOnly, setFilterMarkersOnly] = useState(false);
  const [filterMaturity, setFilterMaturity] = useState<"all" | "draft" | "provisional" | "committed">("all");
  const [validationMap, setValidationMap] = useState<Map<string, ValidationSummary>>(new Map());
  const [markerMap, setMarkerMap] = useState<Map<string, MarkerSummary>>(new Map());
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addType, setAddType] = useState<ProcessFlowType>("screen");
  const [addScreenId, setAddScreenId] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [screens, setScreens] = useState<{ id: string; name: string }[]>([]);
  const [tableDefs, setTableDefs] = useState<ValidatorTableDef[]>([]);
  const [conventions, setConventions] = useState<ConventionsCatalog | null>(null);
  const [viewMode, setViewMode] = usePersistentState<ViewMode>(STORAGE_KEY, "card");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  const loadGroups = useCallback(async () => {
    mcpBridge.startWithoutEditor();
    const p = await loadProject();
    setScreens(p.screens.map((s) => ({ id: s.id, name: s.name })));
    return await listProcessFlows();
  }, []);

  const commitGroups = useCallback(async ({ itemsInOrder, deletedIds }: { itemsInOrder: ProcessFlowMeta[]; deletedIds: string[] }) => {
    for (const id of deletedIds) {
      await deleteProcessFlow(id);
    }
    const project = await loadProject();
    if (project.processFlows) {
      const deletedSet = new Set(deletedIds);
      const orderMap = new Map(itemsInOrder.map((g, i) => [g.id, i]));
      project.processFlows = project.processFlows
        .filter((g) => !deletedSet.has(g.id))
        .sort((a, b) => (orderMap.get(a.id) ?? 0) - (orderMap.get(b.id) ?? 0));
      await saveProject(project);
    }
  }, []);

  const editor = useListEditor<ProcessFlowMeta>({
    getId: (g) => g.id,
    load: loadGroups,
    commit: commitGroups,
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

  // SQL 列検査 / 規約参照のためにテーブル定義・規約カタログをロード (#261 UI 統合)
  useEffect(() => {
    let cancelled = false;
    listTables().then(async (metas) => {
      const defs = await Promise.all(
        metas.map(async (tm) => {
          const full = await loadTable(tm.id);
          if (!full) return null;
          return {
            // sqlColumnValidator は物理名で SQL 列を検証するため v3 では physicalName を渡す。
            id: full.id,
            name: full.physicalName,
            columns: (full.columns ?? []).map((c) => ({ name: c.physicalName })),
          } as ValidatorTableDef;
        }),
      );
      if (!cancelled) setTableDefs(defs.filter((d): d is ValidatorTableDef => d !== null));
    }).catch(console.error);
    // 規約カタログは wsBridge / localStorage 経由で取得 (#317)
    loadConventions()
      .then((c) => { if (!cancelled) setConventions(c as ConventionsCatalog | null); })
      .catch(() => setConventions(null));
    return () => { cancelled = true; };
  }, []);

  const groups = editor.items;

  // バックグラウンドでバリデーション実行
  useEffect(() => {
    if (groups.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const meta of groups) {
        if (cancelled) break;
        const group = await loadProcessFlow(meta.id);
        if (!group || cancelled) continue;
        const errs = aggregateValidation(group, { tables: tableDefs, conventions });
        setValidationMap((prev) => {
          const next = new Map(prev);
          next.set(meta.id, {
            errors: errs.filter((e) => e.severity === "error").length,
            warnings: errs.filter((e) => e.severity === "warning").length,
          });
          return next;
        });
        const openMarkers = (group.authoring?.markers ?? []).filter((m) => !m.resolvedAt);
        const summary: MarkerSummary = {
          todo: openMarkers.filter((m) => m.kind === "todo").length,
          question: openMarkers.filter((m) => m.kind === "question").length,
          attention: openMarkers.filter((m) => m.kind === "attention").length,
          chat: openMarkers.filter((m) => m.kind === "chat").length,
          total: openMarkers.length,
        };
        setMarkerMap((prev) => {
          const next = new Map(prev);
          next.set(meta.id, summary);
          return next;
        });
      }
    })();
    return () => { cancelled = true; };
  }, [groups, tableDefs, conventions]);

  const getErrorPriority = useCallback((id: string): number => {
    const v = validationMap.get(id);
    if (!v) return 0;
    if (v.errors > 0) return 2;
    if (v.warnings > 0) return 1;
    return 0;
  }, [validationMap]);

  const filter = useListFilter(groups);

  useEffect(() => {
    const hasTypeFilter = filterType !== "all";
    const hasMaturityFilter = filterMaturity !== "all";
    if (!hasTypeFilter && !filterErrorsOnly && !filterMarkersOnly && !hasMaturityFilter) {
      filter.applyFilter(null);
      return;
    }
    filter.applyFilter((g) => {
      if (hasTypeFilter && g.kind !== filterType) return false;
      if (filterErrorsOnly && getErrorPriority(g.id) === 0) return false;
      if (filterMarkersOnly && (markerMap.get(g.id)?.total ?? 0) === 0) return false;
      if (hasMaturityFilter) {
        const m = g.maturity ?? "draft";
        if (m !== filterMaturity) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterErrorsOnly, filterMarkersOnly, filterMaturity, validationMap, markerMap]);

  const sortAccessor = useCallback((g: ProcessFlowMeta, key: string): string | number => {
    switch (key) {
      case "name": return g.name;
      case "type": return PROCESS_FLOW_TYPE_LABELS[g.kind as ProcessFlowType] ?? g.kind;
      case "actionCount": return g.actionCount;
      case "screenId": return g.screenId ? 1 : 0;
      case "errorPriority": return getErrorPriority(g.id);
      case "maturity": {
        // draft < provisional < committed で昇順ソート (未指定は draft 扱い)
        const order: Record<string, number> = { draft: 0, provisional: 1, committed: 2 };
        return order[g.maturity ?? "draft"] ?? 0;
      }
      case "notesCount": return g.notesCount ?? 0;
      case "markerCount": return markerMap.get(g.id)?.total ?? 0;
      default: return "";
    }
  }, [getErrorPriority, markerMap]);

  const sort = useListSort(filter.filtered, sortAccessor);
  const selection = useListSelection(sort.sorted, (g) => g.id);
  const clipboard = useListClipboard<ProcessFlowMeta>((g) => g.id);

  const handleActivate = useCallback((g: ProcessFlowMeta) => {
    if (editor.isDeleted(g.id)) return;
    navigate(`/process-flow/edit/${g.id}`);
  }, [navigate, editor]);

  const handleDelete = (items: ProcessFlowMeta[]) => {
    editor.markDeleted(items.map((g) => g.id));
  };

  const handleReorder = (fromIdx: number, toIdx: number) => {
    // docs/spec/list-common.md §3.9: ソート中は DataList 側で D&D が無効化される
    const visible = sort.sorted;
    const fromId = visible[fromIdx]?.id;
    const toId = visible[toIdx]?.id;
    if (!fromId || !toId) return;
    const realFrom = editor.items.findIndex((g) => g.id === fromId);
    const realTo = editor.items.findIndex((g) => g.id === toId);
    if (realFrom < 0 || realTo < 0) return;
    editor.reorder(realFrom, realTo);
  };

  const moveBlock = (items: ProcessFlowMeta[], direction: "up" | "down") => {
    // docs/spec/list-common.md §3.9: ソート中は useListKeyboard 側で Alt+↑↓ が無効化される
    const ids = new Set(items.map((g) => g.id));
    const idxs = editor.items
      .map((g, i) => (ids.has(g.id) ? i : -1))
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

  const duplicateGroup = async (src: ProcessFlowMeta): Promise<string | null> => {
    const full = await loadProcessFlow(src.id);
    if (!full) return null;
    const dup: ProcessFlow = {
      ...full,
      id: generateUUID(),
      name: full.name + " (コピー)",
      actions: full.actions.map((a) => ({
        ...a,
        id: generateUUID(),
        steps: a.steps.map((s) => ({ ...s, id: generateUUID() })),
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await saveProcessFlow(dup);
    return dup.id;
  };

  const handleDuplicate = async (items: ProcessFlowMeta[]) => {
    const newIds: string[] = [];
    for (const g of items) {
      const id = await duplicateGroup(g);
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
      const cutIds = new Set(clipItems.map((c) => c.id));
      const selIds = selection.selectedIds;
      const sameSet = selIds.size === cutIds.size && [...selIds].every((id) => cutIds.has(id));
      if (sameSet) return;

      // docs/spec/list-common.md §3.9: ソート中は useListKeyboard 側で Ctrl+V が無効化される
      clipboard.consume();
      const moved = clipItems;
      const pos0 = insertIdx ?? editor.items.length;
      const removedBefore = editor.items.slice(0, pos0).filter((g) => cutIds.has(g.id)).length;
      const remaining = editor.items.filter((g) => !cutIds.has(g.id));
      const pos = Math.min(remaining.length, pos0 - removedBefore);
      editor.setItems(() => {
        const next = [...remaining];
        next.splice(pos, 0, ...moved);
        return renumber(next);
      });
      selection.setSelectedIds(new Set(moved.map((g) => g.id)));
    } else {
      const newIds: string[] = [];
      for (const g of clipItems) {
        const id = await duplicateGroup(g);
        if (id) newIds.push(id);
      }
      clipboard.consume();
      await editor.reload();
      selection.setSelectedIds(new Set(newIds));
    }
  };

  const sortActive = sort.sortKeys.length > 0;

  const columnLabels = useMemo<Record<string, string>>(() => ({
    name: "名前",
    type: "種別",
    actionCount: "アクション",
    screenId: "画面紐付け",
    errorPriority: "検証",
    markerCount: "マーカー",
  }), []);

  const handleAdd = async () => {
    const name = addName.trim();
    if (!name) return;
    const group = await createProcessFlow(
      name,
      addType,
      addType === "screen" && addScreenId ? addScreenId : undefined,
      addDescription.trim() || undefined,
    );
    setShowAdd(false);
    setAddName("");
    setAddType("screen");
    setAddScreenId("");
    setAddDescription("");
    navigate(`/process-flow/edit/${group.meta?.id ?? group.id}`);
  };

  // docs/spec/list-common.md §3.11: 右クリックメニュー項目を構築
  const buildMenuItems = (target: ProcessFlowMeta | null): ContextMenuItem[] => {
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
          const allIds = editor.items.map((g) => g.id);
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

  const handleContextMenu = (e: React.MouseEvent, target: ProcessFlowMeta | null) => {
    setContextMenu({ x: e.clientX, y: e.clientY, items: buildMenuItems(target) });
  };

  const handleContextMenuKey = (first: ProcessFlowMeta | null, rect: DOMRect | null) => {
    if (first && !selection.isSelected(first.id)) {
      selection.setSelectedIds(new Set([first.id]));
    }
    const x = rect ? rect.left : 100;
    const y = rect ? rect.bottom : 100;
    setContextMenu({ x, y, items: buildMenuItems(first) });
  };

  const handleRowDelete = (g: ProcessFlowMeta) => {
    handleDelete([g]);
  };

  useListKeyboard({
    items: sort.sorted,
    getId: (g) => g.id,
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

  const renderMarkerBadges = (g: ProcessFlowMeta) => {
    const m = markerMap.get(g.id);
    if (!m || m.total === 0) return null;
    const tooltip = MARKER_BADGE_META
      .filter((b) => m[b.kind] > 0)
      .map((b) => `${b.label}: ${m[b.kind]}`)
      .join(" / ");
    return (
      <span className="process-flow-marker-badges" title={`AI 依頼マーカー ${m.total} 件 (${tooltip})`}>
        {MARKER_BADGE_META.map((b) => {
          const count = m[b.kind];
          if (count === 0) return null;
          return (
            <span key={b.kind} className={`process-flow-marker-badge kind-${b.kind}`}>
              <i className={`bi ${b.icon}`} />
              {count}
            </span>
          );
        })}
      </span>
    );
  };

  const columns = useMemo<DataListColumn<ProcessFlowMeta>[]>(() => [
    {
      key: "draft",
      header: "",
      width: "32px",
      align: "center",
      render: (g) => hasDraft("process-flow", g.id)
        ? <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
        : null,
    },
    {
      key: "name",
      header: "名前",
      sortable: true,
      sortAccessor: (g) => g.name,
      render: (g) => <span className="process-flow-list-name">{g.name}</span>,
    },
    {
      key: "type",
      header: "種別",
      width: "130px",
      sortable: true,
      sortAccessor: (g) => PROCESS_FLOW_TYPE_LABELS[g.kind as ProcessFlowType] ?? g.kind,
      render: (g) => (
        <span className={`process-flow-type-badge ${g.kind}`}>
          <i className={`${PROCESS_FLOW_TYPE_ICONS[g.kind as ProcessFlowType] ?? "bi-three-dots"} me-1`} />
          {PROCESS_FLOW_TYPE_LABELS[g.kind as ProcessFlowType] ?? g.kind}
        </span>
      ),
    },
    {
      key: "maturity",
      header: "成熟度",
      width: "80px",
      align: "center",
      sortable: true,
      sortAccessor: (g) => {
        const order: Record<string, number> = { draft: 0, provisional: 1, committed: 2 };
        return order[g.maturity ?? "draft"] ?? 0;
      },
      render: (g) => <MaturityBadge maturity={g.maturity} />,
    },
    {
      key: "actionCount",
      header: "アクション",
      width: "90px",
      align: "right",
      sortable: true,
      sortAccessor: (g) => g.actionCount,
      render: (g) => <span>{g.actionCount}</span>,
    },
    {
      key: "notesCount",
      header: "付箋",
      width: "70px",
      align: "right",
      sortable: true,
      sortAccessor: (g) => g.notesCount ?? 0,
      render: (g) => (g.notesCount ?? 0) > 0 ? <span><i className="bi bi-sticky me-1" />{g.notesCount}</span> : null,
    },
    {
      key: "markerCount",
      header: "マーカー",
      width: "140px",
      align: "left",
      sortable: true,
      sortAccessor: (g) => markerMap.get(g.id)?.total ?? 0,
      render: (g) => renderMarkerBadges(g),
    },
    {
      key: "screenId",
      header: "画面紐付け",
      width: "110px",
      align: "center",
      sortable: true,
      sortAccessor: (g) => (g.screenId ? 1 : 0),
      render: (g) => g.screenId ? <i className="bi bi-display" title="画面紐付きあり" /> : null,
    },
    {
      key: "errorPriority",
      header: "検証",
      width: "100px",
      align: "center",
      sortable: true,
      sortAccessor: (g) => getErrorPriority(g.id),
      render: (g) => {
        const v = validationMap.get(g.id);
        if (!v) return null;
        if (v.errors > 0) return <ValidationBadge severity="error" count={v.errors} />;
        if (v.warnings > 0) return <ValidationBadge severity="warning" count={v.warnings} />;
        return <i className="bi bi-check-lg process-flow-validation-ok" title="問題なし" />;
      },
    },
  ], [validationMap, getErrorPriority, markerMap, hasDraft]);

  const renderCard = (g: ProcessFlowMeta) => {
    const v = validationMap.get(g.id);
    const hasError = (v?.errors ?? 0) > 0;
    const hasWarning = (v?.warnings ?? 0) > 0;
    return (
      <div className={`process-flow-card-content${hasError ? " has-error" : hasWarning ? " has-warning" : ""}`}>
        <div className="process-flow-card-head">
          <span className={`process-flow-type-badge ${g.kind}`}>
            <i className={`${PROCESS_FLOW_TYPE_ICONS[g.kind as ProcessFlowType] ?? "bi-three-dots"} me-1`} />
            {PROCESS_FLOW_TYPE_LABELS[g.kind as ProcessFlowType] ?? g.kind}
          </span>
          <MaturityBadge maturity={g.maturity} />
          <span className="process-flow-card-name">{g.name}</span>
          {hasDraft("process-flow", g.id) && (
            <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
          )}
          {v && (hasError || hasWarning) && (
            <span className="process-flow-validation-badges">
              <ValidationBadge severity="error" count={v.errors} />
              <ValidationBadge severity="warning" count={v.warnings} />
            </span>
          )}
        </div>
        <div className="process-flow-card-meta">
          <span><i className="bi bi-lightning me-1" />アクション: {g.actionCount}件</span>
          {g.screenId && <span><i className="bi bi-display me-1" />画面紐付き</span>}
          {(g.notesCount ?? 0) > 0 && (
            <span title={`付箋 ${g.notesCount} 件`}>
              <i className="bi bi-sticky me-1" />付箋: {g.notesCount}
            </span>
          )}
          {renderMarkerBadges(g)}
        </div>
      </div>
    );
  };

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const g of groups) c[g.kind] = (c[g.kind] ?? 0) + 1;
    return c;
  }, [groups]);

  const deletedCount = editor.deletedIds.size;

  return (
    <div className="process-flow-page">
      <TableSubToolbar />

      <div className="process-flow-content">
        <div className="process-flow-list-header">
          <h5>
            <i className="bi bi-diagram-3 me-2" />処理フロー定義
            {deletedCount > 0 && <span className="process-flow-list-deleted-count"> (削除予定 {deletedCount})</span>}
          </h5>
          {(() => {
            const summary = { draft: 0, provisional: 0, committed: 0, notes: 0 };
            for (const g of groups) {
              const m = g.maturity ?? "draft";
              if (m === "draft") summary.draft++;
              else if (m === "provisional") summary.provisional++;
              else summary.committed++;
              summary.notes += g.notesCount ?? 0;
            }
            if (groups.length === 0) return null;
            return (
              <div className="d-flex align-items-center gap-2 ms-3" style={{ fontSize: "0.8rem" }}>
                <span className="text-muted">全体:</span>
                <span title="確定" style={{ color: "#22c55e" }}>
                  <i className="bi bi-circle-fill" /> {summary.committed}
                </span>
                <span title="暫定" style={{ color: "#f97316" }}>
                  <i className="bi bi-circle-fill" /> {summary.provisional}
                </span>
                <span title="下書き" style={{ color: "#f59e0b" }}>
                  <i className="bi bi-circle-fill" /> {summary.draft}
                </span>
                {summary.notes > 0 && (
                  <span title={`付箋 ${summary.notes} 件`} className="text-muted">
                    <i className="bi bi-sticky" /> {summary.notes}
                  </span>
                )}
                {(() => {
                  const total = MARKER_BADGE_META.reduce((acc, b) => {
                    for (const m of markerMap.values()) acc += m[b.kind];
                    return acc;
                  }, 0);
                  if (total === 0) return null;
                  const tooltip = MARKER_BADGE_META.map((b) => {
                    let n = 0;
                    for (const m of markerMap.values()) n += m[b.kind];
                    return n > 0 ? `${b.label}: ${n}` : null;
                  }).filter(Boolean).join(" / ");
                  return (
                    <span title={`マーカー ${total} 件 (${tooltip})`} className="text-muted">
                      <i className="bi bi-robot" /> {total}
                    </span>
                  );
                })()}
              </div>
            );
          })()}
          <div className="process-flow-list-header-right">
            <ViewModeToggle mode={viewMode} onChange={setViewMode} storageKey={STORAGE_KEY} />
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowAdd(true)}
              disabled={sortActive}
              title={sortActive ? "ソート中は無効 (ソート解除で利用可能)" : undefined}
            >
              <i className="bi bi-plus-lg me-1" />新規作成
            </button>
            <button
              className="btn btn-outline-danger btn-sm"
              onClick={() => handleDelete(selection.selectedItems)}
              disabled={selection.selectedIds.size === 0}
              title="削除 (Delete)"
            >
              <i className="bi bi-trash" /> 削除{selection.selectedIds.size > 0 ? ` (${selection.selectedIds.size})` : ""}
            </button>
            <span className="process-flow-saveline-sep" />
            <button
              className="btn btn-outline-secondary btn-sm"
              data-testid="list-reset-btn"
              onClick={handleReset}
              disabled={!editor.isDirty || editor.isSaving}
              title="変更を破棄"
            >
              <i className="bi bi-arrow-counterclockwise" /> リセット
            </button>
            <button
              className="btn btn-primary btn-sm"
              data-testid="list-save-btn"
              onClick={handleSave}
              disabled={!editor.isDirty || editor.isSaving}
              title="変更を保存"
            >
              <i className="bi bi-save" /> {editor.isSaving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>

        {/* フィルタバー */}
        <div className="process-flow-list-filters">
          <button
            className={`btn btn-sm ${filterType === "all" ? "btn-primary" : "btn-outline-secondary"}`}
            onClick={() => setFilterType("all")}
          >
            すべて ({groups.length})
          </button>
          {ALL_TYPES.map((t) => {
            const count = typeCounts[t] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={t}
                className={`btn btn-sm ${filterType === t ? "btn-primary" : "btn-outline-secondary"}`}
                onClick={() => setFilterType(t)}
              >
                {PROCESS_FLOW_TYPE_LABELS[t]} ({count})
              </button>
            );
          })}

          <div className="process-flow-list-filter-sep" />

          <label className="process-flow-list-check-label">
            <input
              type="checkbox"
              checked={filterErrorsOnly}
              onChange={(e) => setFilterErrorsOnly(e.target.checked)}
            />
            エラーありのみ
          </label>

          <label className="process-flow-list-check-label">
            <input
              type="checkbox"
              checked={filterMarkersOnly}
              onChange={(e) => setFilterMarkersOnly(e.target.checked)}
            />
            <i className="bi bi-robot" /> マーカーありのみ
          </label>

          <div className="process-flow-list-filter-sep" />

          <label className="process-flow-list-check-label" style={{ display: "flex", alignItems: "center", gap: 4 }}>
            成熟度:
            <select
              className="form-select form-select-sm"
              value={filterMaturity}
              onChange={(e) => setFilterMaturity(e.target.value as typeof filterMaturity)}
              style={{ width: "auto", fontSize: "0.85rem" }}
            >
              <option value="all">すべて</option>
              <option value="draft">🟡 draft</option>
              <option value="provisional">🟠 provisional</option>
              <option value="committed">🟢 committed</option>
            </select>
          </label>
        </div>

        <FilterBar
          isActive={filter.isActive}
          totalCount={filter.totalCount}
          visibleCount={filter.visibleCount}
          label={(() => {
            const parts: string[] = [];
            if (filterType !== "all") parts.push(`種別: ${PROCESS_FLOW_TYPE_LABELS[filterType]}`);
            if (filterErrorsOnly) parts.push("エラーあり");
            if (filterMarkersOnly) parts.push("マーカーあり");
            if (filterMaturity !== "all") parts.push(`成熟度: ${filterMaturity}`);
            return parts.length > 0 ? parts.join(" + ") : undefined;
          })()}
          onClear={() => { setFilterType("all"); setFilterErrorsOnly(false); setFilterMarkersOnly(false); setFilterMaturity("all"); }}
        />

        <SortBar sort={sort} columnLabels={columnLabels} />

        <DataList
          items={sort.sorted}
          columns={columns}
          getId={(g) => g.id}
          getNo={(g) => g.no}
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
          className="process-flow-data-list"
          isItemGhost={(id) => editor.isDeleted(id)}
          emptyMessage={
            groups.length === 0
              ? <p>処理フロー定義がまだありません。「新規作成」から追加してください。</p>
              : <p>該当する処理フロー定義がありません。</p>
          }
        />
      </div>

      {/* 新規作成モーダル */}
      {showAdd && (
        <div className="process-flow-modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="process-flow-modal" onClick={(e) => e.stopPropagation()}>
            <h6>処理フロー定義の新規作成</h6>
            <div className="form-group">
              <label className="form-label">名前 *</label>
              <input
                className="form-control form-control-sm"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder="例: ログイン画面、月次集計バッチ"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">種別 *</label>
              <select
                className="form-select form-select-sm"
                value={addType}
                onChange={(e) => setAddType(e.target.value as ProcessFlowType)}
              >
                {ALL_TYPES.map((t) => (
                  <option key={t} value={t}>{PROCESS_FLOW_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            {addType === "screen" && (
              <div className="form-group">
                <label className="form-label">紐付け画面</label>
                <select
                  className="form-select form-select-sm"
                  value={addScreenId}
                  onChange={(e) => setAddScreenId(e.target.value)}
                >
                  <option value="">（なし）</option>
                  {screens.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-group">
              <label className="form-label">説明</label>
              <textarea
                className="form-control form-control-sm"
                rows={2}
                value={addDescription}
                onChange={(e) => setAddDescription(e.target.value)}
                placeholder="処理フローの概要"
              />
            </div>
            <div className="process-flow-modal-footer">
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setShowAdd(false)}>
                キャンセル
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleAdd} disabled={!addName.trim()}>
                作成
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
  );
}
