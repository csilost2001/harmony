// @ts-nocheck
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type {
  ProcessFlow,
  ActionTrigger,
  Step,
  StepType,
} from "../../types/action";
import {
  ACTION_TRIGGER_LABELS,
  STEP_TYPE_LABELS,
  STEP_TYPE_ICONS,
  STEP_TEMPLATES,
} from "../../types/action";
import {
  loadProcessFlow,
  saveProcessFlow,
  addAction,
  removeAction,
  addStep,
  removeStep,
  moveStep,
  addSubStep,
} from "../../store/processFlowStore";
import { listTables, loadTable } from "../../store/tableStore";
import { loadProject } from "../../store/flowStore";
import { getStepLabel, clearJumpReferences } from "../../utils/actionUtils";
import { hasBlockingErrors } from "../../utils/actionValidation";
import { aggregateValidation } from "../../utils/aggregatedValidation";
import type { TableDefinition as ValidatorTableDef } from "../../schemas/sqlColumnValidator";
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";
import { loadExtensionsFromBundle, type LoadedExtensions } from "../../schemas/loadExtensions";
import { loadConventions } from "../../store/conventionsStore";
import { generateUUID } from "../../utils/uuid";
import {
  DndContext,
  closestCenter,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useResourceEditor } from "../../hooks/useResourceEditor";
import { useEditSession } from "../../hooks/useEditSession";
import { useSaveShortcut } from "../../hooks/useSaveShortcut";
import { mcpBridge } from "../../mcp/mcpBridge";
import { useSelectionKeyboard } from "../../hooks/useSelectionKeyboard";
import { STEP_TYPE_COLORS } from "../../types/action";
import { TableSubToolbar } from "../table/TableSubToolbar";
import { SortableStepCard } from "./SortableStepCard";
import { MaturityBadge } from "./MaturityBadge";
import { ActionHttpContractPanel } from "./ActionHttpContractPanel";
import { ActionMetaTabBar } from "./ActionMetaTabBar";
import { SlaPanel } from "./SlaPanel";
import { DrawingOverlay } from "./DrawingOverlay";
import { StructuredFieldsEditor, type ScreenItemPickResult } from "./StructuredFieldsEditor";
import { ScreenItemPickerModal } from "./ScreenItemPickerModal";
import { EditorHeader } from "../common/EditorHeader";
import { EditModeToolbar } from "../editing/EditModeToolbar";
import { DiscardConfirmDialog, ForceReleaseConfirmDialog, ForcedOutChoiceDialog, AfterForceUnlockChoiceDialog } from "../editing/ConfirmDialogs";
import { ResumeOrDiscardDialog } from "../editing/ResumeOrDiscardDialog";
import { setDirty as setTabDirty, makeTabId } from "../../store/tabStore";
import "../../styles/editMode.css";
import { ServerChangeBanner } from "../common/ServerChangeBanner";
import "../../styles/processFlow.css";

/** ツールバーのドラッグ可能なステップ種別ボタン */
function ToolbarStepButton({ type, onClick }: { type: StepType; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `toolbar-${type}`,
    data: { kind: "toolbar-step", stepType: type },
  });
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`step-toolbar-btn${isDragging ? " dragging" : ""}`}
      onClick={onClick}
      title={`${STEP_TYPE_LABELS[type]}（ドラッグで挿入）`}
      style={isDragging ? { opacity: 0.5, borderColor: STEP_TYPE_COLORS[type] } : undefined}
    >
      <i className={STEP_TYPE_ICONS[type]} />
      {STEP_TYPE_LABELS[type]}
    </button>
  );
}

/** ステップ間のドロップゾーン */
function StepInsertZone({ index, onClick, onPaste }: { index: number; onClick: () => void; onPaste?: () => void }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `insert-${index}`,
    data: { kind: "insert-zone", insertIndex: index },
  });
  return (
    <div ref={setNodeRef} className={`step-insert-point${isOver ? " drop-active" : ""}${onPaste ? " has-paste" : ""}`}>
      <button className="step-insert-btn" onClick={onClick} title="ステップを挿入">
        <i className="bi bi-plus" />
      </button>
      {onPaste && (
        <button className="step-paste-btn" onClick={onPaste} title="ここに貼り付け">
          <i className="bi bi-clipboard-plus me-1" />貼り付け
        </button>
      )}
    </div>
  );
}

const ALL_STEP_TYPES: StepType[] = [
  "validation", "dbAccess", "externalSystem", "commonProcess",
  "screenTransition", "displayUpdate", "branch", "loop",
  "loopBreak", "loopContinue", "jump", "compute", "return", "other",
  "log", "audit", "workflow", "transactionScope",
  "eventPublish", "eventSubscribe", "closing", "cdc",
];

const ALL_SUB_STEP_TYPES: StepType[] = [
  "validation", "dbAccess", "externalSystem", "commonProcess",
  "screenTransition", "displayUpdate", "branch", "loop",
  "loopBreak", "loopContinue", "jump", "compute", "return", "other",
  "log", "audit", "workflow", "transactionScope",
  "eventPublish", "eventSubscribe", "closing", "cdc",
];

const ALL_TRIGGERS: ActionTrigger[] = ["click", "submit", "select", "change", "load", "timer", "other"];

function CustomStepButton({ id, label, icon, description }: { id: string; label: string; icon: string; description: string }) {
  return (
    <button
      type="button"
      className="step-toolbar-btn"
      disabled
      title={`D&D 配置は別 ISSUE で対応予定: ${id}`}
      aria-disabled="true"
    >
      <i className={icon || "bi bi-puzzle"} />
      {label || id}
      {description ? <span className="visually-hidden">{description}</span> : null}
    </button>
  );
}

export function ProcessFlowEditor() {
  const { processFlowId } = useParams<{ processFlowId: string }>();
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [showAddAction, setShowAddAction] = useState(false);
  // 画面項目ピッカー (#321) — Promise ベース: StructuredFieldsEditor に onPickScreenItem を渡す
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerResolveRef = useRef<((r: ScreenItemPickResult | null) => void) | null>(null);
  const [newActionName, setNewActionName] = useState("");
  const [newActionTrigger, setNewActionTrigger] = useState<ActionTrigger>("click");
  const [tables, setTables] = useState<{ id: string; physicalName: string; name: string }[]>([]);
  const [screens, setScreens] = useState<{ id: string; name: string }[]>([]);
  const [commonGroups, setCommonGroups] = useState<{ id: string; name: string }[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showWarningsPanel, setShowWarningsPanel] = useState(false);
  const [drawingMode, setDrawingMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; stepId: string } | null>(null);
  const [contextMenuSubTypePicker, setContextMenuSubTypePicker] = useState(false);
  // SQL 列検査 / 規約参照検査のため (#261)
  const [tableDefs, setTableDefs] = useState<ValidatorTableDef[]>([]);
  const [conventions, setConventions] = useState<ConventionsCatalog | null>(null);
  const [extensions, setExtensions] = useState<LoadedExtensions | undefined>(undefined);
  const [newStepIds, setNewStepIds] = useState<Set<string>>(new Set());

  // 選択・クリップボード state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [clipboard, setClipboard] = useState<{
    steps: Step[];
    mode: "cut" | "copy";
  } | null>(null);
  const lastSelectedIdRef = useRef<string | null>(null);

  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showForceReleaseDialog, setShowForceReleaseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);

  const handleNotFound = useCallback(() => navigate(wsPath("/process-flow/list"), { replace: true }), [navigate, wsPath]);

  const handleLoaded = useCallback((g: ProcessFlow) => {
    setActiveActionId((cur) => cur ?? (g.actions.length > 0 ? g.actions[0].id : null));
    loadProject().then((p) => {
      setScreens(p.screens.map((s) => ({ id: s.id, name: s.name })));
      const agMetas = p.processFlows ?? [];
      setCommonGroups(agMetas.filter((a) => a.type === "common").map((a) => ({ id: a.id, name: a.name })));
    }).catch(console.error);
    listTables().then(async (metas) => {
      setTables(metas.map((tm) => ({ id: tm.id, physicalName: tm.physicalName ?? "", name: tm.name })));
      // SQL 列検査用に全テーブルの columns まで読む (#261 UI 統合)
      const defs = await Promise.all(
        metas.map(async (tm) => {
          const full = await loadTable(tm.id);
          if (!full) return null;
          return {
            // sqlColumnValidator は物理名 (snake_case) で SQL 列を検証するため、
            // v3 では table.physicalName / column.physicalName を渡す (v3 の name は表示名)。
            id: full.id,
            name: full.physicalName,
            columns: (full.columns ?? []).map((c) => ({ name: c.physicalName })),
          } as ValidatorTableDef;
        }),
      );
      setTableDefs(defs.filter((d): d is ValidatorTableDef => d !== null));
    }).catch(console.error);
    // 規約カタログは wsBridge / localStorage 経由で取得 (#317)。
    // 未接続時は null。編集は「規約カタログ」タブから。
    loadConventions()
      .then((c) => setConventions(c as ConventionsCatalog | null))
      .catch(() => setConventions(null));
    mcpBridge.getExtensions()
      .then((bundle) => setExtensions(loadExtensionsFromBundle(bundle).extensions))
      .catch(() => setExtensions(undefined));
  }, []);

  const {
    state: group,
    isDirty, isSaving, serverChanged,
    update: updateGroup,
    updateSilent: updateGroupSilent,
    commit: commitGroup,
    undo, redo, canUndo, canRedo,
    handleSave: hookHandleSave,
    handleReset, dismissServerBanner,
  } = useResourceEditor<ProcessFlow>({
    tabType: "process-flow",
    mtimeKind: "processFlow",
    draftKind: "process-flow",
    id: processFlowId,
    load: loadProcessFlow,
    save: saveProcessFlow,
    broadcastName: "processFlowChanged",
    broadcastIdField: "id",
    onNotFound: handleNotFound,
    onLoaded: handleLoaded,
  });

  const sessionId = mcpBridge.getSessionId();
  const { mode, loading: sessionLoading, isDirtyForTab, actions: editActions } = useEditSession({
    resourceType: "process-flow",
    resourceId: processFlowId ?? "",
    sessionId,
  });

  const isReadonly = mode.kind !== "editing";

  // ProcessFlowEditor の live 状態を mcpBridge に公開 (#361 browser-first)
  const groupRef = useRef<ProcessFlow | null>(null);

  useEffect(() => {
    groupRef.current = group ?? null;
  }, [group]);

  useEffect(() => {
    if (!processFlowId) return;
    mcpBridge.setProcessFlowHandler(processFlowId, {
      get: () => groupRef.current,
      mutate: (type, params) => {
        updateGroup((g) => applyProcessFlowMutation(g, type, params as Record<string, unknown>));
      },
    });
    return () => mcpBridge.setProcessFlowHandler(processFlowId, null);
  }, [processFlowId, updateGroup]);

  const draftUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleDraftUpdate = useCallback(() => {
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!processFlowId || !groupRef.current) return;
      mcpBridge.updateDraft("process-flow", processFlowId, groupRef.current).catch(console.error);
    }, 300);
  }, [processFlowId]);

  const updateGroupWithDraft = useCallback((fn: (g: ProcessFlow) => void) => {
    if (isReadonly) return;
    updateGroup(fn);
    scheduleDraftUpdate();
  }, [isReadonly, updateGroup, scheduleDraftUpdate]);

  const updateGroupSilentWithDraft = useCallback((fn: (g: ProcessFlow) => void) => {
    if (isReadonly) return;
    updateGroupSilent(fn);
    scheduleDraftUpdate();
  }, [isReadonly, updateGroupSilent, scheduleDraftUpdate]);

  const handleDiscard = useCallback(async () => {
    setShowDiscardDialog(false);
    await editActions.discard();
    await handleReset();
  }, [editActions, handleReset]);

  const handleForceRelease = useCallback(async () => {
    setShowForceReleaseDialog(false);
    await editActions.forceReleaseOther();
  }, [editActions]);

  const handleResumeContinue = useCallback(async () => {
    setShowResumeDialog(false);
    await editActions.startEditing();
  }, [editActions]);

  const handleResumeDiscard = useCallback(async () => {
    setShowResumeDialog(false);
    if (processFlowId) await mcpBridge.discardDraft("process-flow", processFlowId);
    await handleReset();
  }, [processFlowId, handleReset]);

  // 保存時にバリデーションをチェック（blocking なエラーがあれば中断）
  const handleSave = useCallback(async () => {
    if (!group || isReadonly || hasBlockingErrors(aggregateValidation(group, { tables: tableDefs, conventions, extensions }))) return;
    await hookHandleSave();
    await editActions.save();
  }, [group, isReadonly, hookHandleSave, tableDefs, conventions, extensions, editActions]);

  // D&D: PointerSensor に移動距離閾値を設定（クリックとドラッグを区別）
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // D&D: ステップリストの境界外でのドロップをキャンセルするための ref
  const stepListRef = useRef<HTMLDivElement>(null);

  // ポインターがステップリスト内にあるときのみ衝突判定を行う
  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointer = args.pointerCoordinates;
    if (pointer && stepListRef.current) {
      const { top, bottom } = stepListRef.current.getBoundingClientRect();
      if (pointer.y < top || pointer.y > bottom) return [];
    }
    return closestCenter(args);
  }, []);

  useSaveShortcut(() => {
    if (isDirty && !isSaving && !isReadonly) handleSave();
  });

  useEffect(() => {
    if (!processFlowId) return;
    const tabId = makeTabId("process-flow", processFlowId);
    setTabDirty(tabId, isDirtyForTab || isDirty);
  }, [processFlowId, isDirtyForTab, isDirty]);

  useEffect(() => {
    if (!processFlowId || sessionLoading) return;
    if (mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      const res = await mcpBridge.hasDraft("process-flow", processFlowId) as { exists: boolean } | null;
      if (cancelled) return;
      if (res?.exists) setShowResumeDialog(true);
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [processFlowId, sessionLoading, mode.kind]);

  const validationErrors = useMemo(
    () => group ? aggregateValidation(group, { tables: tableDefs, conventions, extensions }) : [],
    [group, tableDefs, conventions, extensions],
  );

  useEffect(() => {
    return mcpBridge.onExtensionsChanged(() => {
      mcpBridge.getExtensions(true)
        .then((bundle) => setExtensions(loadExtensionsFromBundle(bundle).extensions))
        .catch(() => setExtensions(undefined));
    });
  }, []);

  const customStepCards = Object.entries(extensions?.steps ?? {});

  const activeAction = group?.actions.find((a) => a.id === activeActionId) ?? null;

  const handleAddAction = () => {
    const name = newActionName.trim();
    if (!name || !group) return;
    updateGroupWithDraft((g) => {
      const act = addAction(g, name, newActionTrigger);
      setActiveActionId(act.id);
    });
    setShowAddAction(false);
    setNewActionName("");
    setNewActionTrigger("click");
  };

  const handleDeleteAction = (actionId: string) => {
    if (!confirm("このアクションを削除しますか？")) return;
    updateGroupWithDraft((g) => {
      removeAction(g, actionId);
      if (activeActionId === actionId) {
        setActiveActionId(g.actions.length > 0 ? g.actions[0].id : null);
      }
    });
  };

  const handleAddStep = (type: StepType, insertIndex?: number) => {
    if (!activeAction) return;
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (act) {
        const step = addStep(act, type, insertIndex);
        setNewStepIds((prev) => new Set(prev).add(step.id));
      }
    });
  };

  const handleAddTemplate = (templateId: string) => {
    const tpl = STEP_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl || !activeAction) return;
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      for (const stepDef of tpl.steps) {
        const step = { ...stepDef, id: generateUUID() } as Step;
        act.steps.push(step);
      }
    });
    setShowTemplates(false);
  };

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
    setContextMenuSubTypePicker(false);
  }, []);

  const handleDeleteStep = (stepId: string) => {
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      clearJumpReferences(act.steps, stepId);
      removeStep(act, stepId);
    });
    closeContextMenu();
  };

  const handleIndentStep = (stepId: string) => {
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      const idx = act.steps.findIndex((s) => s.id === stepId);
      if (idx <= 0) return;
      const stepToMove = act.steps[idx];
      const target = { ...act.steps[idx - 1] };
      target.subSteps = [...(target.subSteps ?? []), stepToMove];
      act.steps[idx - 1] = target;
      act.steps.splice(idx, 1);
    });
  };

  const handleOutdentSubStep = (parentStepId: string, subStepId: string) => {
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      const parentIdx = act.steps.findIndex((s) => s.id === parentStepId);
      if (parentIdx < 0) return;
      const parent = act.steps[parentIdx];
      const subIdx = (parent.subSteps ?? []).findIndex((s) => s.id === subStepId);
      if (subIdx < 0) return;
      const subStep = parent.subSteps![subIdx];
      act.steps[parentIdx] = { ...parent, subSteps: parent.subSteps!.filter((s) => s.id !== subStepId) };
      act.steps.splice(parentIdx + 1, 0, subStep);
    });
  };

  const handleMoveStep = (fromIndex: number, toIndex: number) => {
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (act) moveStep(act, fromIndex, toIndex);
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !activeAction) return;

    const dragKind = active.data.current?.kind;

    if (dragKind === "toolbar-step") {
      // #46: ツールバーからドロップ → 新規ステップを挿入
      const stepType = active.data.current?.stepType as StepType;
      const insertIndex = over.data.current?.insertIndex as number | undefined;
      handleAddStep(stepType, insertIndex ?? activeAction.steps.length);
    } else {
      // #47: ステップカードの並べ替え
      if (active.id === over.id) return;
      const fromIndex = activeAction.steps.findIndex((s) => s.id === active.id);
      const toIndex = activeAction.steps.findIndex((s) => s.id === over.id);
      if (fromIndex < 0 || toIndex < 0) return;
      handleMoveStep(fromIndex, toIndex);
    }
  };

  const handleStepChange = (stepId: string, changes: Partial<Step>) => {
    updateGroupSilentWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      const step = act.steps.find((s) => s.id === stepId);
      if (step) Object.assign(step, changes);
    });
  };

  const handleAddSubStep = (parentStepId: string, type: StepType) => {
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      const parent = act.steps.find((s) => s.id === parentStepId);
      if (parent) addSubStep(parent, type);
    });
    closeContextMenu();
  };

  const handleDuplicateStep = (stepId: string) => {
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      const idx = act.steps.findIndex((s) => s.id === stepId);
      if (idx < 0) return;
      const clone = JSON.parse(JSON.stringify(act.steps[idx])) as Step;
      clone.id = generateUUID();
      if (clone.subSteps) {
        clone.subSteps = clone.subSteps.map((s) => ({ ...s, id: generateUUID() }));
      }
      act.steps.splice(idx + 1, 0, clone);
    });
    closeContextMenu();
  };

  // ── 選択操作 ──────────────────────────────────────────────────
  const handleStepClick = (stepId: string, e: React.MouseEvent) => {
    if (!activeAction) return;
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Click: トグル
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(stepId)) next.delete(stepId);
        else next.add(stepId);
        return next;
      });
      lastSelectedIdRef.current = stepId;
    } else if (e.shiftKey && lastSelectedIdRef.current) {
      // Shift+Click: 範囲選択
      const steps = activeAction.steps;
      const lastIdx = steps.findIndex((s) => s.id === lastSelectedIdRef.current);
      const curIdx = steps.findIndex((s) => s.id === stepId);
      if (lastIdx >= 0 && curIdx >= 0) {
        const [from, to] = lastIdx < curIdx ? [lastIdx, curIdx] : [curIdx, lastIdx];
        const range = new Set<string>();
        for (let i = from; i <= to; i++) range.add(steps[i].id);
        setSelectedIds(range);
      }
    } else {
      // 通常クリック: 選択解除（展開/折りたたみはStepCard内で処理）
      setSelectedIds(new Set());
      lastSelectedIdRef.current = null;
    }
  };

  // ── クリップボード操作 ────────────────────────────────────────
  const handleCut = () => {
    if (selectedIds.size === 0 || !activeAction) return;
    const steps = activeAction.steps.filter((s) => selectedIds.has(s.id));
    setClipboard({ steps: JSON.parse(JSON.stringify(steps)), mode: "cut" });
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      for (const id of selectedIds) {
        clearJumpReferences(act.steps, id);
        removeStep(act, id);
      }
    });
    setSelectedIds(new Set());
  };

  const handleCopy = () => {
    if (selectedIds.size === 0 || !activeAction) return;
    const steps = activeAction.steps.filter((s) => selectedIds.has(s.id));
    setClipboard({ steps: JSON.parse(JSON.stringify(steps)), mode: "copy" });
  };

  const handlePaste = (insertIndex?: number) => {
    if (!clipboard || !activeAction) return;
    const targetIndex = insertIndex ?? (() => {
      // 選択中のステップがある場合: 最後の選択ステップの直後
      if (selectedIds.size > 0) {
        const lastIdx = Math.max(...activeAction.steps.map((s, i) => selectedIds.has(s.id) ? i : -1));
        return lastIdx >= 0 ? lastIdx + 1 : activeAction.steps.length;
      }
      return activeAction.steps.length;
    })();

    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      const newSteps = clipboard.steps.map((s) => {
        const clone = JSON.parse(JSON.stringify(s)) as Step;
        clone.id = generateUUID();
        if (clone.subSteps) {
          clone.subSteps = clone.subSteps.map((sub: Step) => ({ ...sub, id: generateUUID() }));
        }
        return clone;
      });
      act.steps.splice(targetIndex, 0, ...newSteps);
    });
    if (clipboard.mode === "cut") setClipboard(null);
    setSelectedIds(new Set());
  };

  const handleEscapeSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  useSelectionKeyboard({
    onCut: handleCut,
    onCopy: handleCopy,
    onPaste: () => handlePaste(),
    onEscape: handleEscapeSelection,
    enabled: selectedIds.size > 0 || clipboard !== null,
  });

  // 画面項目ピッカーのコールバック (#321) — hooks は early return より前で定義
  const handlePickScreenItem = useCallback((): Promise<ScreenItemPickResult | null> => {
    return new Promise((resolve) => {
      pickerResolveRef.current = resolve;
      setPickerOpen(true);
    });
  }, []);

  if (!group || sessionLoading) return null;

  const lockedByOther = mode.kind === "locked-by-other" ? mode : null;

  const handleCommitStrokes = (shape: {
    type: "path";
    d: string;
    color?: string;
    strokeWidth?: number;
    anchorStepId?: string;
    anchorFieldPath?: string;
  }) => {
    const body = window.prompt(
      "描画マーカーへの指示を入力:\n(例: ここの SQL を affectedRowsCheck で補強して)",
    );
    if (!body || !body.trim()) return;
    updateGroupWithDraft((g) => {
      // anchor があれば Marker.stepId / fieldPath にも自動反映:
      // /designer-work スラッシュコマンドは stepId / fieldPath を既存で読むので、
      // AI 側は「どの step のどのフィールドへの指示か」を即座に把握できる。
      // ただし __meta-tab-* は ActionMetaTabBar の body 用擬似 ID (#309 フォローアップ) で
      // 実 step ID ではないため、Marker.stepId / fieldPath にはコピーしない
      // (shape.anchorStepId 側に残るので DrawingOverlay の位置追従は効く)。
      const isMetaTabAnchor = shape.anchorStepId?.startsWith("__meta-tab-") ?? false;
      g.authoring = { ...(g.authoring ?? {}), markers: [...(g.authoring?.markers ?? []), {
        id: generateUUID(),
        kind: "todo",
        body: body.trim(),
        shape,
        stepId: isMetaTabAnchor ? undefined : shape.anchorStepId,
        fieldPath: isMetaTabAnchor ? undefined : shape.anchorFieldPath,
        author: "human",
        createdAt: new Date().toISOString(),
      }] };
    });
    setDrawingMode(false);
  };

  const handleEraseMarker = (markerId: string) => {
    updateGroupWithDraft((g) => {
      g.authoring = { ...(g.authoring ?? {}), markers: (g.authoring?.markers ?? []).filter((m) => m.id !== markerId) };
    });
  };

  const handleExitDrawing = () => {
    setDrawingMode(false);
  };

  const handlePickerPick = (result: ScreenItemPickResult) => {
    pickerResolveRef.current?.(result);
    pickerResolveRef.current = null;
    setPickerOpen(false);
  };

  const handlePickerClose = () => {
    pickerResolveRef.current?.(null);
    pickerResolveRef.current = null;
    setPickerOpen(false);
  };

  return (
    <div className={`process-flow-page${isReadonly ? " readonly-mode" : ""}`} onClick={() => closeContextMenu()} style={{ position: "relative" }}>
      <TableSubToolbar />

      <EditModeToolbar
        mode={mode}
        onStartEditing={editActions.startEditing}
        onSave={handleSave}
        onDiscardClick={() => setShowDiscardDialog(true)}
        onForceReleaseClick={() => setShowForceReleaseDialog(true)}
        saving={isSaving}
        ownerLabel={lockedByOther?.ownerSessionId}
      />

      {mode.kind === "force-released-pending" && (
        <ForcedOutChoiceDialog
          previousDraftExists={mode.previousDraftExists}
          onChoice={(choice) => editActions.handleForcedOut(choice)}
        />
      )}

      {mode.kind === "after-force-unlock" && (
        <AfterForceUnlockChoiceDialog
          previousOwner={mode.previousOwner}
          onChoice={(choice) => editActions.handleAfterForceUnlock(choice)}
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

      {serverChanged && (
        <ServerChangeBanner onReload={handleReset} onDismiss={dismissServerBanner} />
      )}

      <EditorHeader
        title={
          <div className="process-flow-editor-breadcrumb">
            <Link to={wsPath("/process-flow/list")}>処理フロー一覧</Link>
            <span className="mx-2">/</span>
            <span className="fw-semibold text-dark">{group.meta?.name ?? ""}</span>
          </div>
        }
        undoRedo={{ onUndo: undo, onRedo: redo, canUndo, canRedo }}
        extraRight={
          <>
            <button
              type="button"
              className={`btn btn-sm ${drawingMode ? "btn-danger" : "btn-outline-secondary"}`}
              onClick={() => setDrawingMode((v) => !v)}
              title="赤線マーカー (ドラッグで描画、離すとマーカー起票)"
            >
              <i className="bi bi-pencil" /> {drawingMode ? "描画中" : "描画"}
            </button>
            {validationErrors.filter((e) => e.severity === "error").length > 0 && (
              <span
                className="validation-badge error"
                title={validationErrors
                  .filter((e) => e.severity === "error")
                  .map((e) => (e.path ? `[${e.path}] ${e.message}` : e.message))
                  .join("\n")}
              >
                <i className="bi bi-x-circle-fill" />
                {validationErrors.filter((e) => e.severity === "error").length} エラー
              </span>
            )}
            {validationErrors.filter((e) => e.severity === "warning").length > 0 && (
              <span
                className="validation-badge warning clickable"
                title={validationErrors
                  .filter((e) => e.severity === "warning")
                  .slice(0, 20)
                  .map((e) => (e.path ? `[${e.path}] ${e.message}` : e.message))
                  .join("\n")}
                onClick={() => setShowWarningsPanel((v) => !v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setShowWarningsPanel((v) => !v); }}
              >
                <i className="bi bi-exclamation-triangle-fill" />
                {validationErrors.filter((e) => e.severity === "warning").length} 警告
                <i className={`bi bi-chevron-${showWarningsPanel ? "up" : "down"} ms-1`} />
              </span>
            )}
          </>
        }
        saveReset={isReadonly ? undefined : { isDirty, isSaving, onSave: handleSave, onReset: handleReset }}
      />

      {/* 警告詳細パネル (#261 UI 統合) */}
      {showWarningsPanel && validationErrors.filter((e) => e.severity === "warning").length > 0 && (
        <div className="process-flow-validation-panel">
          <div className="process-flow-validation-panel-header">
            <i className="bi bi-exclamation-triangle-fill" /> 警告 ({validationErrors.filter((e) => e.severity === "warning").length} 件)
            <button
              className="btn btn-sm btn-link process-flow-validation-panel-bulk-ai"
              onClick={() => {
                // 全警告をまとめて marker 化 (既に起票済のものは skip)
                if (!group) return;
                const existingKeys = new Set((group.authoring?.markers ?? [])
                  .filter((m) => !m.resolvedAt && m.kind === "todo")
                  .map((m) => `${m.code ?? ""}|${m.path ?? ""}`));
                const newMarkers = validationErrors
                  .filter((e) => e.severity === "warning" && e.path)
                  .filter((e) => !existingKeys.has(`${e.code ?? ""}|${e.path ?? ""}`))
                  .map((e) => ({
                    id: generateUUID(),
                    kind: "todo" as const,
                    body: `警告解消: ${e.message}`,
                    stepId: e.stepId || undefined,
                    code: e.code,
                    path: e.path,
                    author: "human" as const,
                    createdAt: new Date().toISOString(),
                  }));
                if (newMarkers.length === 0) {
                  window.alert("全ての警告は既に AI 依頼済みです");
                  return;
                }
                updateGroupWithDraft((g) => {
                  g.authoring = { ...(g.authoring ?? {}), markers: [...(g.authoring?.markers ?? []), ...newMarkers] };
                });
                window.alert(`${newMarkers.length} 件の警告を marker として起票しました。/designer-work で処理できます。`);
              }}
              title="全ての警告をまとめて AI 依頼 marker として起票"
            >
              <i className="bi bi-robot" /> 全て AI に依頼
            </button>
            <button
              className="btn btn-sm btn-link ms-1"
              onClick={() => setShowWarningsPanel(false)}
              title="閉じる"
            >
              <i className="bi bi-x-lg" />
            </button>
          </div>
          <ul className="process-flow-validation-panel-list">
            {validationErrors
              .filter((e) => e.severity === "warning")
              .map((e, i) => {
                const isMarked = (group?.authoring?.markers ?? [])
                  .some((m) => !m.resolvedAt && m.kind === "todo"
                    && m.code === e.code && m.path === e.path);
                return (
                  <li key={i}>
                    {e.code && <span className="validation-code">{e.code}</span>}
                    <span className="validation-message">{e.message}</span>
                    {e.path && <span className="validation-path">{e.path}</span>}
                    <button
                      className={`btn btn-sm validation-ask-ai-btn ${isMarked ? "asked" : ""}`}
                      disabled={isMarked || !group}
                      title={isMarked ? "AI に依頼済み" : "この警告を marker として AI に依頼"}
                      onClick={() => {
                        if (!group || isMarked) return;
                        const newMarker = {
                          id: generateUUID(),
                          kind: "todo" as const,
                          body: `警告解消: ${e.message}`,
                          stepId: e.stepId || undefined,
                          code: e.code,
                          path: e.path,
                          author: "human" as const,
                          createdAt: new Date().toISOString(),
                        };
                        updateGroupWithDraft((g) => {
                          g.authoring = { ...(g.authoring ?? {}), markers: [...(g.authoring?.markers ?? []), newMarker] };
                        });
                      }}
                    >
                      <i className={`bi ${isMarked ? "bi-check-circle-fill" : "bi-robot"}`} />
                      {" "}{isMarked ? "依頼済" : "AI に依頼"}
                    </button>
                  </li>
                );
              })}
          </ul>
        </div>
      )}

      {/* グループ情報 + カタログ群 (#309 タブバー化) */}
      <ActionMetaTabBar
        group={group}
        updateGroup={updateGroup}
        updateGroupSilent={updateGroupSilent}
      />

      {/* アクションタブ */}
      <div className="process-flow-tabs">
        {group.actions.map((act) => (
          <div key={act.id} className="d-flex align-items-center">
            <button
              className={`process-flow-tab ${activeActionId === act.id ? "active" : ""}`}
              onClick={() => setActiveActionId(act.id)}
            >
              <MaturityBadge
                maturity={act.maturity}
                onChange={(next) => {
                  updateGroupSilent((g) => {
                    const a = g.actions.find((a2) => a2.id === act.id);
                    if (a) a.maturity = next;
                  });
                }}
              />
              {act.name}
              <span className="ms-1 text-muted small">({ACTION_TRIGGER_LABELS[act.trigger]})</span>
            </button>
            <button
              className="btn btn-link btn-sm text-muted p-0 ms-1"
              onClick={() => handleDeleteAction(act.id)}
              title="アクション削除"
              style={{ fontSize: "0.7rem" }}
            >
              <i className="bi bi-x" />
            </button>
          </div>
        ))}
        <button
          className="process-flow-tab-add"
          onClick={() => setShowAddAction(true)}
          title="アクション追加"
        >
          <i className="bi bi-plus-lg" />
        </button>
      </div>

      {/* ステップエディタ */}
      <div className="process-flow-content">
        {activeAction ? (
          <div className="step-editor">
            {/* HTTP 契約 */}
            <ActionHttpContractPanel
              action={activeAction}
              onChange={(patch) => {
                updateGroupSilent((g) => {
                  const act = g.actions.find((a) => a.id === activeActionId);
                  if (act) Object.assign(act, patch);
                });
                commitGroup();
              }}
            />
            <SlaPanel
              label="アクション SLA / Timeout"
              sla={activeAction.sla}
              onChange={(sla) => {
                updateGroupSilent((g) => {
                  const act = g.actions.find((a) => a.id === activeActionId);
                  if (act) act.sla = sla;
                });
                commitGroup();
              }}
            />
            {/* I/O パネル */}
            <div className="process-flow-io-panel">
              <div className="process-flow-io-field">
                <StructuredFieldsEditor
                  label="入力データ"
                  fields={activeAction.inputs}
                  onChange={(val) => {
                    updateGroupSilent((g) => {
                      const act = g.actions.find((a) => a.id === activeActionId);
                      if (act) act.inputs = val;
                    });
                  }}
                  onCommit={commitGroup}
                  placeholder="例: ユーザID、パスワード（改行で複数項目）"
                  onPickScreenItem={handlePickScreenItem}
                />
              </div>
              <div className="process-flow-io-field">
                <StructuredFieldsEditor
                  label="出力データ"
                  fields={activeAction.outputs}
                  onChange={(val) => {
                    updateGroupSilent((g) => {
                      const act = g.actions.find((a) => a.id === activeActionId);
                      if (act) act.outputs = val;
                    });
                  }}
                  onCommit={commitGroup}
                  placeholder="例: セッションID、認証トークン（改行で複数項目）"
                  onPickScreenItem={handlePickScreenItem}
                />
              </div>
            </div>

            <DndContext sensors={sensors} onDragEnd={handleDragEnd} collisionDetection={collisionDetection}>
              {/* ツールバー */}
              <div className="step-toolbar">
                {ALL_STEP_TYPES.map((type) => (
                  <ToolbarStepButton key={type} type={type} onClick={() => handleAddStep(type)} />
                ))}
                {customStepCards.length > 0 && (
                  <>
                    <div className="step-toolbar-sep" />
                    <div className="small text-muted d-flex align-items-center px-1">カスタム</div>
                    {customStepCards.map(([id, step]) => (
                      <CustomStepButton
                        key={id}
                        id={id}
                        label={step.label}
                        icon={step.icon}
                        description={step.description}
                      />
                    ))}
                  </>
                )}
                <div className="step-toolbar-sep" />
                <div style={{ position: "relative" }}>
                  <button
                    className="step-template-btn"
                    onClick={() => setShowTemplates(!showTemplates)}
                  >
                    <i className="bi bi-collection" />
                    テンプレート
                  </button>
                  {showTemplates && (
                    <div className="template-dropdown">
                      {STEP_TEMPLATES.map((tpl) => (
                        <div
                          key={tpl.id}
                          className="template-dropdown-item"
                          onClick={() => handleAddTemplate(tpl.id)}
                        >
                          <div className="template-dropdown-item-label">{tpl.label}</div>
                          <div className="template-dropdown-item-desc">{tpl.description}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* ステップリスト */}
              {activeAction.steps.length === 0 ? (
                <div className="step-empty">
                  <i className="bi bi-plus-circle" />
                  ステップがありません。上のボタンから追加するか、テンプレートを使用してください。
                </div>
              ) : (
                <SortableContext items={activeAction.steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                  <div className="step-list" ref={stepListRef}>
                    {activeAction.steps.map((step, index) => {
                      // この step に紐付いた未解決 marker 件数
                      const stepMarkers = (group.authoring?.markers ?? []).filter(
                        (m) => !m.resolvedAt && m.stepId === step.id,
                      );
                      const markerCount = stepMarkers.length;
                      const markerTooltip = markerCount > 0
                        ? `AI 依頼マーカー ${markerCount} 件:\n${stepMarkers.map((m) => `- [${m.kind}] ${m.body.slice(0, 60)}`).join("\n")}`
                        : undefined;
                      const markerKinds = markerCount > 0 ? {
                        todo: stepMarkers.filter((m) => m.kind === "todo").length,
                        question: stepMarkers.filter((m) => m.kind === "question").length,
                        attention: stepMarkers.filter((m) => m.kind === "attention").length,
                        chat: stepMarkers.filter((m) => m.kind === "chat").length,
                      } : undefined;
                      return (
                      <div key={step.id}>
                        <StepInsertZone
                          index={index}
                          onClick={() => handleAddStep("other", index)}
                          onPaste={clipboard ? () => handlePaste(index) : undefined}
                        />
                        <SortableStepCard
                          step={step}
                          index={index}
                          label={getStepLabel(index)}
                          allSteps={activeAction.steps}
                          tables={tables}
                          screens={screens}
                          commonGroups={commonGroups}
                          onChange={(changes) => handleStepChange(step.id, changes)}
                          onCommit={commitGroup}
                          onMoveUp={index > 0 ? () => handleMoveStep(index, index - 1) : undefined}
                          onMoveDown={index < activeAction.steps.length - 1 ? () => handleMoveStep(index, index + 1) : undefined}
                          onDelete={() => handleDeleteStep(step.id)}
                          onDuplicate={() => handleDuplicateStep(step.id)}
                          onAddSubStep={(type) => handleAddSubStep(step.id, type)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setContextMenu({ x: e.clientX, y: e.clientY, stepId: step.id });
                          }}
                          onNavigateCommon={(refId) => navigate(`/process-flow/edit/${refId}`)}
                          defaultExpanded={newStepIds.has(step.id)}
                          selected={selectedIds.has(step.id)}
                          onHeaderClick={(e) => handleStepClick(step.id, e)}
                          onIndent={index > 0 ? () => handleIndentStep(step.id) : undefined}
                          onOutdentSubStep={(subId) => handleOutdentSubStep(step.id, subId)}
                          validationErrors={validationErrors}
                          onAddMarker={(body, kind = "todo") => {
                            updateGroupWithDraft((g) => {
                              const m = {
                                id: generateUUID(),
                                kind,
                                body,
                                stepId: step.id,
                                author: "human" as const,
                                createdAt: new Date().toISOString(),
                              };
                              g.authoring = { ...(g.authoring ?? {}), markers: [...(g.authoring?.markers ?? []), m] };
                            });
                          }}
                          markerCount={markerCount}
                          markerTooltip={markerTooltip}
                          markerKinds={markerKinds}
                          conventions={conventions}
                          group={group}
                        />
                      </div>
                      );
                    })}
                    {/* 末尾の挿入ポイント */}
                    <StepInsertZone
                      index={activeAction.steps.length}
                      onClick={() => handleAddStep("other")}
                      onPaste={clipboard ? () => handlePaste(activeAction.steps.length) : undefined}
                    />
                  </div>
                </SortableContext>
              )}
            </DndContext>
          </div>
        ) : (
          <div className="step-empty">
            <i className="bi bi-lightning" />
            アクションがありません。「+」ボタンからアクションを追加してください。
          </div>
        )}
      </div>

      {/* コンテキストメニュー */}
      {contextMenu && (
        <div
          className="step-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {!contextMenuSubTypePicker ? (
            <>
              <button
                className="step-context-menu-item"
                onClick={() => handleDuplicateStep(contextMenu.stepId)}
              >
                <i className="bi bi-copy" /> 複製
              </button>
              <button
                className="step-context-menu-item"
                onClick={() => setContextMenuSubTypePicker(true)}
              >
                <i className="bi bi-diagram-2" /> サブステップ追加 ▶
              </button>
              <div className="step-context-menu-sep" />
              <button
                className="step-context-menu-item danger"
                onClick={() => handleDeleteStep(contextMenu.stepId)}
              >
                <i className="bi bi-trash" /> 削除
              </button>
            </>
          ) : (
            <>
              <button
                className="step-context-menu-item"
                onClick={() => setContextMenuSubTypePicker(false)}
              >
                <i className="bi bi-arrow-left" /> 戻る
              </button>
              <div className="step-context-menu-sep" />
              {ALL_SUB_STEP_TYPES.map((t) => (
                <button
                  key={t}
                  className="step-context-menu-item"
                  onClick={() => { handleAddSubStep(contextMenu.stepId, t); }}
                >
                  <i className={`bi ${STEP_TYPE_ICONS[t]}`} style={{ color: STEP_TYPE_COLORS[t] }} />
                  {" "}{STEP_TYPE_LABELS[t]}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* アクション追加モーダル */}
      {showAddAction && (
        <div className="process-flow-modal-overlay" onClick={() => setShowAddAction(false)}>
          <div className="process-flow-modal" onClick={(e) => e.stopPropagation()}>
            <h6>アクション追加</h6>
            <div className="form-group">
              <label className="form-label">アクション名 *</label>
              <input
                className="form-control form-control-sm"
                value={newActionName}
                onChange={(e) => setNewActionName(e.target.value)}
                placeholder="例: 登録ボタン、検索ボタン"
                autoFocus
              />
            </div>
            <div className="form-group">
              <label className="form-label">トリガー</label>
              <select
                className="form-select form-select-sm"
                value={newActionTrigger}
                onChange={(e) => setNewActionTrigger(e.target.value as ActionTrigger)}
              >
                {ALL_TRIGGERS.map((t) => (
                  <option key={t} value={t}>{ACTION_TRIGGER_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div className="process-flow-modal-footer">
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setShowAddAction(false)}>
                キャンセル
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleAddAction} disabled={!newActionName.trim()}>
                追加
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 赤線マーカー描画オーバーレイ (#261) */}
      <DrawingOverlay
        markers={group.authoring?.markers ?? []}
        drawing={drawingMode}
        onCommitStrokes={handleCommitStrokes}
        onEraseMarker={handleEraseMarker}
        onExitDrawing={handleExitDrawing}
      />
      {/* 画面項目ピッカー (#321) */}
      <ScreenItemPickerModal
        open={pickerOpen}
        onClose={handlePickerClose}
        onPick={handlePickerPick}
      />
    </div>
  );
}

// ── browser-first 処理フロー変異ヘルパー (#361) ──────────────────────────────
// add_step / remove_step / moveStep は processFlowStore の関数を再利用し、
// ファイルベース (processFlowEdits.ts) と実装が乖離しないようにする。

function applyProcessFlowMutation(
  g: ProcessFlow,
  type: string,
  p: Record<string, unknown>,
): void {
  switch (type) {
    case "designer__add_step": {
      const act = g.actions.find((a) => a.id === p.actionId);
      if (!act) return;
      const pos = typeof p.position === "number" ? p.position : undefined;
      const step = addStep(act, p.type as StepType, pos);
      if (p.description) step.description = p.description as string;
      Object.assign(step, (p.detail ?? {}) as object);
      break;
    }
    case "designer__update_step": {
      for (const act of g.actions) {
        const step = act.steps.find((s) => s.id === p.stepId);
        if (step) { Object.assign(step, p.patch); return; }
      }
      break;
    }
    case "designer__remove_step": {
      for (const act of g.actions) {
        const idx = act.steps.findIndex((s) => s.id === p.stepId);
        if (idx >= 0) { removeStep(act, p.stepId as string); return; }
      }
      break;
    }
    case "designer__move_step": {
      const newIndex = p.newIndex as number;
      for (const act of g.actions) {
        const fromIdx = act.steps.findIndex((s) => s.id === p.stepId);
        if (fromIdx >= 0) { moveStep(act, fromIdx, newIndex); return; }
      }
      break;
    }
  }
}
