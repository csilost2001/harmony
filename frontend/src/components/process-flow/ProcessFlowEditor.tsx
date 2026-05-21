// Phase-3 (#1145): 94KB → 30KB 目標で以下を抽出:
//   - internal/PaletteButtons.tsx (ToolbarStepButton / StepInsertZone / EmptyFlowDropZone / CustomStepButton)
//   - internal/ActionHelpPopover.tsx
//   - internal/actionTriggerConstants.ts (trigger 定数 + ヘルパー)
//   - internal/AddActionModal.tsx
//   - internal/StepContextMenu.tsx
//   - internal/WarningsPanel.tsx
//   - internal/stepCardConstants.ts に ALL_STEP_TYPES を追加
// 残置: ProcessFlowEditor 本体 (state 統合 / D&D / edit-session 連携 / 主 JSX)。
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
// #1186 Phase 2-B: types/action → types/v3 + processFlowMetadata 移行
// ProcessFlow / Step は v3 strict 型、StepType は StepKind alias、ActionTrigger は v3 ActionTrigger
import type {
  ProcessFlow,
  ActionTrigger,
  Step,
  StepKind as StepType,
  Uuid,
  LocalId,
  Timestamp,
} from "../../types/v3";
import { STEP_TEMPLATES, STEP_TYPE_LABELS } from "../../utils/processFlowMetadata";
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
import { applyProcessFlowMutation } from "./processFlowMutation";
import { clearJumpReferences, type StepWithSubSteps } from "../../utils/actionUtils";
import { hasBlockingErrors } from "../../utils/actionValidation";
import { aggregateValidation } from "../../utils/aggregatedValidation";
import { generateUUID } from "../../utils/uuid";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type CollisionDetection,
} from "@dnd-kit/core";
import { useResourceEditor } from "../../hooks/useResourceEditor";
import { useEditSession } from "../../hooks/useEditSession";
import { useSaveShortcut } from "../../hooks/useSaveShortcut";
import { useSessionUrlSync } from "../../hooks/useSessionUrlSync";
import { mcpBridge } from "../../mcp/mcpBridge";
import { useSelectionKeyboard } from "../../hooks/useSelectionKeyboard";
import { TableSubToolbar } from "../table/TableSubToolbar";
import { DrawingOverlay } from "./DrawingOverlay";
import { type ScreenItemPickResult } from "./StructuredFieldsEditor";
import { ScreenItemPickerModal } from "./ScreenItemPickerModal";
import { applyProcessFlowDiffSelection, replaceProcessFlowContents } from "./AiDiffPreviewDialogUtils";
import { useEditLevel } from "../../hooks/useEditLevel";
import { useAiContextChips } from "../../hooks/useAiContextChips";
import { useCodexStatus } from "../../codex/useCodexStatus";
import { requestProcessFlowPartial, AiUnavailableError } from "../../codex/processFlowPartialRequest";
import { EditorHeader } from "../common/EditorHeader";
import { EditModeToolbar } from "../editing/EditModeToolbar";
import { setDirty as setTabDirty, makeTabId } from "../../store/tabStore";
import "../../styles/editMode.css";
import "../../styles/processFlow.css";
// Phase-3 (#1145) で抽出した internal 部品群
import { AddActionModal } from "./internal/AddActionModal";
import { StepContextMenu } from "./internal/StepContextMenu";
import { WarningsPanel } from "./internal/WarningsPanel";
import { ALL_STEP_TYPES } from "./internal/stepCardConstants";
import { getActionTriggerLabel } from "./internal/actionTriggerConstants";
import { ProcessFlowDialogs } from "./internal/ProcessFlowDialogs";
import { useProcessFlowCatalogs } from "./internal/useProcessFlowCatalogs";
import { useActionHelpPopover } from "./internal/useActionHelpPopover";
import { ActionTabBar } from "./internal/ActionTabBar";
import { PalettePanel } from "./internal/PalettePanel";
import { InspectorPanel } from "./internal/InspectorPanel";
import { CanvasPane } from "./internal/CanvasPane";
import { EditorHeaderExtras } from "./internal/EditorHeaderExtras";

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
  // カタログ群 (tables / screens / commonGroups / tableDefs / conventions /
  // extensions / genericDefNames / projectCatalogs) は Phase-3 で
  // useProcessFlowCatalogs フックに集約 (#1145)。
  const {
    tables,
    screens,
    commonGroups,
    tableDefs,
    conventions,
    extensions,
    genericDefNames,
    projectCatalogs,
    loadAll: loadAllCatalogs,
  } = useProcessFlowCatalogs();
  const [showTemplates, setShowTemplates] = useState(false);
  const [showWarningsPanel, setShowWarningsPanel] = useState(false);
  const [drawingMode, setDrawingMode] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; stepId: string } | null>(null);
  const [contextMenuSubTypePicker, setContextMenuSubTypePicker] = useState(false);
  const [isDraggingToolbarStep, setIsDraggingToolbarStep] = useState(false);
  const [stepFilter, setStepFilter] = useState("");
  const [commandQuery, setCommandQuery] = useState("");
  // ActionHelpPopover の位置 / open-close debounce は useActionHelpPopover に集約 (#1145 Phase-3)。
  const {
    actionHelp,
    openActionHelp,
    scheduleCloseActionHelp,
    clearActionHelpCloseTimer,
  } = useActionHelpPopover();
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
  const [showAiGenerateDialog, setShowAiGenerateDialog] = useState(false);
  const [showAiReviewDialog, setShowAiReviewDialog] = useState(false);

  // #1076 AI 依頼 UX
  const { editLevel, setEditLevel } = useEditLevel(processFlowId);
  const aiChips = useAiContextChips();
  const { buildContextString } = aiChips;
  const { status: codexStatus } = useCodexStatus();
  const isCodexConnected = codexStatus.kind === "authenticated";
  const [aiRequestBusy, setAiRequestBusy] = useState(false);
  const [aiRequestError, setAiRequestError] = useState<string | null>(null);
  const [aiDiffProposed, setAiDiffProposed] = useState<ProcessFlow | null>(null);
  const [aiPromptSummary, setAiPromptSummary] = useState<string>("");
  const aiPanelRef = useRef<HTMLDivElement | null>(null);

  const handleNotFound = useCallback(() => navigate(wsPath("/process-flow/list"), { replace: true }), [navigate, wsPath]);

  const handleLoaded = useCallback((g: ProcessFlow) => {
    setActiveActionId((cur) => cur ?? (g.actions.length > 0 ? g.actions[0].id : null));
    // 規約 / extensions / table / screen / commonGroup 等のカタログを useProcessFlowCatalogs に委譲。
    loadAllCatalogs(g);
  }, [loadAllCatalogs]);

  const sessionId = mcpBridge.getSessionId();

  // URL ?session= 同期 (spec §11.2) — initialEditSessionId を useEditSession に渡すため先に呼ぶ
  const { syncSessionToUrl, initialEditSessionId: initialProcessFlowSessionId } = useSessionUrlSync({
    resourceType: "process-flow",
    resourceId: processFlowId ?? "",
  });

  // P2-2 fix (#907): URL ?session= から復元した initialEditSessionId を渡す (URL 招待 attach 復活)
  // #891 fix: useResourceEditor より前に呼び出し、viewerMode / viewerEditSessionId を渡せるようにする
  const { editSession, mode, loading: sessionLoading, isDirtyForTab, actions: editActions, attach: editAttach, takeOver: editTakeOver, saveConflict, onSaveConflictOverwrite, onSaveConflictCancel } = useEditSession({
    resourceType: "process-flow",
    resourceId: processFlowId ?? "",
    sessionId,
    editSessionId: initialProcessFlowSessionId,
  });

  const {
    state: group,
    isDirty, isSaving, serverChanged,
    update: updateGroup,
    updateSilent: updateGroupSilent,
    commit: commitGroup,
    undo, redo, canUndo, canRedo,
    postSave: hookPostSave,
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
    // #891 fix: viewer mode で mid-edit broadcast を受信するため渡す
    // mode.kind の全バリアントを useResourceEditor の制限型にキャスト (非 viewer 値は内部で無視される)
    viewerMode: mode.kind as "viewer" | "editing" | "readonly" | undefined,
    viewerResourceType: "process-flow",
    viewerEditSessionId: editSession?.id,
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
      if (editSession?.id) {
        mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: groupRef.current }).catch(console.error);
      }
    }, 300);
  }, [processFlowId, editSession]);

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
    await editActions.discard();
    await handleReset();
  }, [editActions, handleReset]);

  // #1076 AI 依頼送信ハンドラ
  const handleAiSubmit = useCallback(async (prompt: string) => {
    if (!group || isReadonly) return;
    setAiRequestBusy(true);
    setAiRequestError(null);
    setAiPromptSummary(prompt.slice(0, 80));
    try {
      const contextString = buildContextString();
      const result = await requestProcessFlowPartial({
        current: group,
        contextString,
        prompt,
      });
      setAiDiffProposed(result.proposed);
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        setAiRequestError("Codex が接続されていません。右上の Codex メニューからログインしてください。");
      } else {
        setAiRequestError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setAiRequestBusy(false);
    }
  }, [group, isReadonly, buildContextString]);

  // 保存時にバリデーションをチェック（blocking なエラーがあれば中断）
  const handleSave = useCallback(async () => {
    if (!group || isReadonly || hasBlockingErrors(aggregateValidation(group, {
      tables: tableDefs,
      conventions,
      extensions,
      genericDefinitionNames: genericDefNames,
      projectCatalogs,
    }))) return;
    // P1 fix (#908 round-5): debounce 中の draft を flush して即送信、その後 conflict check
    if (draftUpdateTimer.current) {
      clearTimeout(draftUpdateTimer.current);
      draftUpdateTimer.current = null;
    }
    if (groupRef.current && editSession?.id) {
      await mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: groupRef.current });
    }
    // P1 fix (#908): conflict 時は hookPostSave をスキップして clean 化を防ぐ。
    const { conflicted, failed } = await editActions.save();
    if (conflicted || failed) return;
    await hookPostSave();
  }, [group, isReadonly, hookPostSave, tableDefs, conventions, extensions, genericDefNames, projectCatalogs, editActions, editSession]);

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
      // workspace context が未確立の場合 WorkspaceUnsetError が返ることがあるため最大 25 回 retry する (200ms × 25 = 5s)
      for (let attempt = 0; attempt < 25 && !cancelled; attempt++) {
        try {
          const res = await mcpBridge.request("editSession.list", { resourceType: "process-flow", resourceId: processFlowId }) as { sessions: Array<{ state?: string; participants?: Record<string, unknown> }> } | null;
          if (cancelled) return;
          // #980-A: 自分が participant として参加していた Active session のみ対象。
          // 他人の Active session で自分が unparticipated の場合は ResumeOrDiscardDialog を出さない
          // (= 「未保存の自分の draft があります」というメッセージ意図と矛盾するため)。
          const mySessionId = mcpBridge.getSessionId();
          const hasMyActiveSession = (res?.sessions ?? []).some((s) =>
            s.state === "Active" && !!s.participants?.[mySessionId],
          );
          if (hasMyActiveSession) setShowResumeDialog(true);
          return;
        } catch (err) {
          if (cancelled) return;
          const msg = String((err as Error)?.message ?? err);
          if (!msg.includes("WorkspaceUnset") && !msg.includes("workspace not")) {
            console.error(err);
            return;
          }
          await new Promise(r => setTimeout(r, 200));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [processFlowId, sessionLoading, mode.kind]);

  const validationErrors = useMemo(
    () => group ? aggregateValidation(group, {
      tables: tableDefs,
      conventions,
      extensions,
      genericDefinitionNames: genericDefNames,
      projectCatalogs,
    }) : [],
    [group, tableDefs, conventions, extensions, genericDefNames, projectCatalogs],
  );

  // mcpBridge.onExtensionsChanged の watch は useProcessFlowCatalogs 内で管理 (Phase-3)。

  const customStepCards = Object.entries(extensions?.steps ?? {});
  const normalizedStepFilter = stepFilter.trim().toLowerCase();
  const filteredStepTypes = normalizedStepFilter
    ? ALL_STEP_TYPES.filter((type) => {
      const label = STEP_TYPE_LABELS[type] ?? type;
      return type.toLowerCase().includes(normalizedStepFilter) || label.toLowerCase().includes(normalizedStepFilter);
    })
    : ALL_STEP_TYPES;

  const activeAction = group?.actions.find((a) => a.id === activeActionId) ?? null;
  const normalizedCommandQuery = commandQuery.trim().toLowerCase();
  const visibleActions = group?.actions.filter((act) => {
    if (!normalizedCommandQuery) return true;
    return act.name.toLowerCase().includes(normalizedCommandQuery)
      || getActionTriggerLabel(act.trigger).toLowerCase().includes(normalizedCommandQuery)
      || act.trigger.toLowerCase().includes(normalizedCommandQuery);
  }) ?? [];
  const actionHelpTarget = actionHelp && group
    ? group.actions.find((act) => act.id === actionHelp.actionId) ?? null
    : null;
  const actionHelpTargetIndex = actionHelpTarget && group
    ? group.actions.findIndex((act) => act.id === actionHelpTarget.id)
    : -1;

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

  // ActionHelpPopover の位置 / open-close debounce は useActionHelpPopover に集約済 (Phase-3)。

  const handleAddStep = (kind: StepType, insertIndex?: number) => {
    if (!activeAction) return;
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (act) {
        const step = addStep(act, kind, insertIndex);
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
      for (const stepDef of (tpl.steps ?? [])) {
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

  const handleDeleteStep = useCallback((stepId: string) => {
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      clearJumpReferences(act.steps, stepId);
      removeStep(act, stepId);
    });
    closeContextMenu();
  }, [activeActionId, updateGroupWithDraft, closeContextMenu]);

  const handleIndentStep = (stepId: string) => {
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      const idx = act.steps.findIndex((s) => s.id === stepId);
      if (idx <= 0) return;
      const stepToMove = act.steps[idx];
      const target = { ...act.steps[idx - 1] } as StepWithSubSteps;
      target.subSteps = [...(target.subSteps ?? []), stepToMove];
      act.steps[idx - 1] = target as unknown as Step;
      act.steps.splice(idx, 1);
    });
  };

  const handleOutdentSubStep = (parentStepId: string, subStepId: string) => {
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      const parentIdx = act.steps.findIndex((s) => s.id === parentStepId);
      if (parentIdx < 0) return;
      const parent = act.steps[parentIdx] as StepWithSubSteps;
      const subIdx = (parent.subSteps ?? []).findIndex((s) => s.id === subStepId);
      if (subIdx < 0) return;
      const subStep = parent.subSteps![subIdx];
      act.steps[parentIdx] = { ...parent, subSteps: parent.subSteps!.filter((s) => s.id !== subStepId) } as unknown as Step;
      act.steps.splice(parentIdx + 1, 0, subStep);
    });
  };

  const handleMoveStep = useCallback((fromIndex: number, toIndex: number) => {
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (act) moveStep(act, fromIndex, toIndex);
    });
  }, [activeActionId, updateGroupWithDraft]);

  const handleDragStart = (event: { active: { data: { current?: Record<string, unknown> } } }) => {
    setIsDraggingToolbarStep(event.active.data.current?.kind === "toolbar-step");
  };

  const handleDragCancel = () => {
    setIsDraggingToolbarStep(false);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setIsDraggingToolbarStep(false);
    if (isReadonly) return;
    const { active, over } = event;
    if (!over || !activeAction) return;

    const dragKind = active.data.current?.kind;

    if (dragKind === "toolbar-step") {
      // #46: ツールバーからドロップ → 新規ステップを挿入
      const stepType = active.data.current?.stepType as StepType;
      let insertIndex = over.data.current?.insertIndex as number | undefined;
      if (insertIndex === undefined) {
        const overStepIndex = activeAction.steps.findIndex((s) => s.id === over.id);
        insertIndex = overStepIndex >= 0 ? overStepIndex : activeAction.steps.length;
      }
      handleAddStep(stepType, insertIndex);
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

  const handleAddSubStep = (parentStepId: string, kind: StepType) => {
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      const parent = act.steps.find((s) => s.id === parentStepId);
      if (parent) addSubStep(parent, kind);
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
      clone.id = generateUUID() as LocalId;
      const cloneWithSubs = clone as StepWithSubSteps;
      if (cloneWithSubs.subSteps) {
        cloneWithSubs.subSteps = cloneWithSubs.subSteps.map((s) => ({ ...s, id: generateUUID() as LocalId }));
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
  const handleCut = (ids = selectedIds) => {
    if (ids.size === 0 || !activeAction) return;
    const steps = activeAction.steps.filter((s) => ids.has(s.id));
    setClipboard({ steps: JSON.parse(JSON.stringify(steps)), mode: "cut" });
    updateGroupWithDraft((g) => {
      const act = g.actions.find((a) => a.id === activeActionId);
      if (!act) return;
      for (const id of ids) {
        clearJumpReferences(act.steps, id);
        removeStep(act, id);
      }
    });
    setSelectedIds(new Set());
    closeContextMenu();
  };

  const handleCopy = (ids = selectedIds) => {
    if (ids.size === 0 || !activeAction) return;
    const steps = activeAction.steps.filter((s) => ids.has(s.id));
    setClipboard({ steps: JSON.parse(JSON.stringify(steps)), mode: "copy" });
    closeContextMenu();
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
        clone.id = generateUUID() as LocalId;
        const cloneWithSubs = clone as StepWithSubSteps;
        if (cloneWithSubs.subSteps) {
          cloneWithSubs.subSteps = cloneWithSubs.subSteps.map((sub) => ({ ...sub, id: generateUUID() as LocalId }));
        }
        return clone;
      });
      act.steps.splice(targetIndex, 0, ...newSteps);
    });
    if (clipboard.mode === "cut") setClipboard(null);
    setSelectedIds(new Set());
    closeContextMenu();
  };

  const getContextStepIndex = () => {
    if (!contextMenu || !activeAction) return -1;
    return activeAction.steps.findIndex((s) => s.id === contextMenu.stepId);
  };

  const handleContextInsert = (offset: 0 | 1) => {
    const idx = getContextStepIndex();
    if (idx < 0) return;
    handleAddStep("other", idx + offset);
    closeContextMenu();
  };

  const handleContextPaste = (offset: 0 | 1) => {
    const idx = getContextStepIndex();
    if (idx < 0) return;
    handlePaste(idx + offset);
  };

  const handleEscapeSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    for (const id of Array.from(selectedIds)) {
      handleDeleteStep(id);
    }
    setSelectedIds(new Set());
  }, [selectedIds, handleDeleteStep]);

  const handleMoveSelectedByKeyboard = useCallback((direction: -1 | 1) => {
    if (!activeAction || selectedIds.size !== 1) return;
    const id = Array.from(selectedIds)[0];
    const fromIndex = activeAction.steps.findIndex((s) => s.id === id);
    const toIndex = fromIndex + direction;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= activeAction.steps.length) return;
    handleMoveStep(fromIndex, toIndex);
  }, [activeAction, selectedIds, handleMoveStep]);

  useSelectionKeyboard({
    onCut: handleCut,
    onCopy: handleCopy,
    onPaste: () => handlePaste(),
    onDelete: handleDeleteSelected,
    onMoveUp: () => handleMoveSelectedByKeyboard(-1),
    onMoveDown: () => handleMoveSelectedByKeyboard(1),
    onEscape: handleEscapeSelection,
    enabled: !isReadonly && (selectedIds.size > 0 || clipboard !== null),
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
      // anchor があれば Marker.anchor.stepId / anchor.fieldPath に反映:
      // /designer-work スラッシュコマンドは anchor.stepId / anchor.fieldPath を読むので、
      // AI 側は「どの step のどのフィールドへの指示か」を即座に把握できる。
      // ただし __meta-tab-* は ActionMetaTabBar の body 用擬似 ID (#309 フォローアップ) で
      // 実 step ID ではないため、anchor.stepId / anchor.fieldPath にはコピーしない
      // (anchor.shape は常に記録するので DrawingOverlay の位置追従は効く)。
      const isMetaTabAnchor = shape.anchorStepId?.startsWith("__meta-tab-") ?? false;
      g.authoring = { ...(g.authoring ?? {}), markers: [...(g.authoring?.markers ?? []), {
        id: generateUUID() as Uuid,
        kind: "todo" as const,
        body: body.trim(),
        anchor: {
          stepId: (isMetaTabAnchor ? undefined : shape.anchorStepId) as LocalId | undefined,
          fieldPath: isMetaTabAnchor ? undefined : shape.anchorFieldPath,
          shape: {
            kind: "path" as const,
            d: shape.d,
            color: shape.color,
            strokeWidth: shape.strokeWidth,
          },
        },
        author: "human" as const,
        createdAt: new Date().toISOString() as Timestamp,
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

      <ProcessFlowDialogs
        group={group}
        mode={mode}
        lockedByOther={lockedByOther}
        showResumeDialog={showResumeDialog}
        showDiscardDialog={showDiscardDialog}
        showForceReleaseDialog={showForceReleaseDialog}
        showAiGenerateDialog={showAiGenerateDialog}
        showAiReviewDialog={showAiReviewDialog}
        serverChanged={serverChanged}
        onForcedOutChoice={(choice) => editActions.handleForcedOut(choice as "continue" | "discard" | "adopt")}
        onAfterForceUnlockChoice={(choice) => editActions.handleAfterForceUnlock(choice as "continue" | "discard" | "adopt")}
        onResumeContinue={handleResumeContinue}
        onResumeDiscard={handleResumeDiscard}
        onCancelResume={() => setShowResumeDialog(false)}
        onDiscardConfirm={handleDiscard}
        onDiscardCancel={() => setShowDiscardDialog(false)}
        onForceReleaseConfirm={handleForceRelease}
        onForceReleaseCancel={() => setShowForceReleaseDialog(false)}
        saveConflict={saveConflict}
        onSaveConflictOverwrite={async () => {
          try {
            await onSaveConflictOverwrite();
            await hookPostSave();
          } catch (e) {
            console.error("[ProcessFlowEditor] save overwrite failed:", e);
          }
        }}
        onSaveConflictCancel={onSaveConflictCancel}
        onServerReload={handleReset}
        onServerDismiss={dismissServerBanner}
        onCloseAiGenerate={() => setShowAiGenerateDialog(false)}
        onApplyAiGenerate={(next) => {
          updateGroupWithDraft((g) => {
            replaceProcessFlowContents(g, next);
          });
        }}
        onCloseAiReview={() => setShowAiReviewDialog(false)}
        aiDiffProposed={aiDiffProposed}
        aiPromptSummary={aiPromptSummary}
        onApplyAiDiff={(proposed) => {
          updateGroupWithDraft((g) => {
            replaceProcessFlowContents(g, proposed);
          });
          setAiDiffProposed(null);
        }}
        onApplyAiDiffSelected={(proposed, paths) => {
          updateGroupWithDraft((g) => {
            applyProcessFlowDiffSelection(g, proposed, paths);
          });
          setAiDiffProposed(null);
        }}
        onDiscardAiDiff={() => setAiDiffProposed(null)}
        onAddAiDiffMarker={(body) => {
          updateGroupWithDraft((g) => {
            const m = {
              id: generateUUID() as Uuid,
              kind: "chat" as const,
              body,
              author: "human" as const,
              createdAt: new Date().toISOString() as Timestamp,
            };
            g.authoring = {
              ...(g.authoring ?? {}),
              markers: [...(g.authoring?.markers ?? []), m],
            };
          });
          setAiDiffProposed(null);
        }}
      />


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
          <EditorHeaderExtras
            isReadonly={isReadonly}
            drawingMode={drawingMode}
            showWarningsPanel={showWarningsPanel}
            validationErrors={validationErrors}
            processFlowId={processFlowId ?? ""}
            mode={mode}
            sessionId={sessionId}
            onOpenAiGenerate={() => setShowAiGenerateDialog(true)}
            onOpenAiReview={() => setShowAiReviewDialog(true)}
            onToggleDrawing={() => setDrawingMode((v) => !v)}
            onToggleWarnings={() => setShowWarningsPanel((v) => !v)}
            onStartEditing={() => { void editActions.startEditing(); }}
            onViewerAttached={syncSessionToUrl}
            onAttachAsView={editAttach}
            onTakeOver={editTakeOver}
          />
        }
        saveReset={isReadonly ? undefined : { isDirty, isSaving, onSave: handleSave, onReset: handleReset }}
      />

      {/* 警告詳細パネル (#261 UI 統合、Phase-3 で internal/WarningsPanel に抽出) */}
      {showWarningsPanel && (
        <WarningsPanel
          group={group}
          validationErrors={validationErrors}
          onClose={() => setShowWarningsPanel(false)}
          onUpdateProcessFlow={updateGroupWithDraft}
        />
      )}

      <div className="process-flow-workbench">
        <ActionTabBar
          group={group}
          activeAction={activeAction}
          activeActionId={activeActionId}
          visibleActions={visibleActions}
          commandQuery={commandQuery}
          onChangeCommandQuery={setCommandQuery}
          onSelectAction={setActiveActionId}
          onDeleteAction={handleDeleteAction}
          onAddActionClick={() => setShowAddAction(true)}
          isReadonly={isReadonly}
          editLevel={editLevel}
          onChangeEditLevel={setEditLevel}
          onChangeActionMaturity={(actId, next) => {
            updateGroupSilent((g) => {
              const a = g.actions.find((a2) => a2.id === actId);
              if (a) a.maturity = next;
            });
          }}
          actionHelp={actionHelp}
          actionHelpTarget={actionHelpTarget}
          actionHelpTargetIndex={actionHelpTargetIndex}
          openActionHelp={openActionHelp}
          scheduleCloseActionHelp={scheduleCloseActionHelp}
          clearActionHelpCloseTimer={clearActionHelpCloseTimer}
        />

        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
          collisionDetection={collisionDetection}
        >
          <div className="process-flow-workbench-grid">
            <PalettePanel
              stepFilter={stepFilter}
              onChangeStepFilter={setStepFilter}
              filteredStepTypes={filteredStepTypes}
              customStepCards={customStepCards}
              showTemplates={showTemplates}
              onToggleTemplates={() => setShowTemplates(!showTemplates)}
              onAddStep={handleAddStep}
              onAddTemplate={handleAddTemplate}
              isReadonly={isReadonly}
            />

            <CanvasPane
              group={group}
              activeAction={activeAction}
              tables={tables}
              screens={screens}
              commonGroups={commonGroups}
              conventions={conventions}
              isReadonly={isReadonly}
              isDraggingToolbarStep={isDraggingToolbarStep}
              clipboard={clipboard}
              newStepIds={newStepIds}
              selectedIds={selectedIds}
              validationErrors={validationErrors}
              editLevel={editLevel}
              stepListRef={stepListRef}
              aiChips={aiChips}
              aiPanelRef={aiPanelRef}
              handleAddStep={handleAddStep}
              handlePaste={handlePaste}
              handleStepChange={handleStepChange}
              commitGroup={commitGroup}
              handleMoveStep={handleMoveStep}
              handleDeleteStep={handleDeleteStep}
              handleDuplicateStep={handleDuplicateStep}
              handleAddSubStep={handleAddSubStep}
              handleIndentStep={handleIndentStep}
              handleOutdentSubStep={handleOutdentSubStep}
              handleStepClick={handleStepClick}
              onNavigateCommon={(refId) => navigate(wsPath(`/process-flow/edit/${refId}`))}
              updateGroupWithDraft={updateGroupWithDraft}
              onContextMenu={(stepId, x, y) => setContextMenu({ x, y, stepId })}
              setSelectedIds={setSelectedIds}
              lastSelectedIdRef={lastSelectedIdRef}
            />
            {/* CanvasPane (#1145 Phase-3 で抽出): ステップリスト + D&D 挿入ゾーン */}

            <InspectorPanel
              group={group}
              activeAction={activeAction}
              activeActionId={activeActionId}
              isReadonly={isReadonly}
              processFlowId={processFlowId}
              aiChips={aiChips}
              handleAiSubmit={handleAiSubmit}
              aiRequestBusy={aiRequestBusy}
              aiRequestError={aiRequestError}
              isCodexConnected={isCodexConnected}
              aiPanelRef={aiPanelRef}
              updateGroup={updateGroup}
              updateGroupSilent={updateGroupSilent}
              commitGroup={commitGroup}
              handlePickScreenItem={handlePickScreenItem}
            />
            {/* InspectorPanel (#1145 Phase-3 で抽出): AI 依頼 / Meta / HTTP contract / SLA / I/O */}
          </div>
        </DndContext>
      </div>

      {/* コンテキストメニュー (Phase-3 で internal/StepContextMenu に抽出) */}
      {!isReadonly && contextMenu && (
        <StepContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          stepId={contextMenu.stepId}
          subTypePickerOpen={contextMenuSubTypePicker}
          hasClipboard={!!clipboard}
          onToggleSubTypePicker={setContextMenuSubTypePicker}
          onInsertBefore={() => handleContextInsert(0)}
          onInsertAfter={() => handleContextInsert(1)}
          onPasteBefore={() => handleContextPaste(0)}
          onPasteAfter={() => handleContextPaste(1)}
          onCopy={() => handleCopy(new Set([contextMenu.stepId]))}
          onCut={() => handleCut(new Set([contextMenu.stepId]))}
          onDuplicate={() => handleDuplicateStep(contextMenu.stepId)}
          onAddSubStep={(kind) => handleAddSubStep(contextMenu.stepId, kind)}
          onAskAi={() => {
            const step = group?.actions?.flatMap((a) => a.steps ?? []).find((s) => s.id === contextMenu.stepId);
            if (step) {
              const action = group?.actions?.find((a) =>
                (a.steps ?? []).some((s) => s.id === contextMenu.stepId),
              );
              const stepIndex = (action?.steps ?? []).findIndex((s) => s.id === contextMenu.stepId);
              const label = `S${stepIndex + 1}: ${step.description ?? step.kind ?? step.id}`;
              aiChips.addStepChip(String(contextMenu.stepId), label, step);
            }
            aiPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
            setContextMenu(null);
          }}
          onDelete={() => handleDeleteStep(contextMenu.stepId)}
        />
      )}

      {/* アクション追加モーダル (Phase-3 で internal/AddActionModal に抽出) */}
      {showAddAction && !isReadonly && (
        <AddActionModal
          name={newActionName}
          trigger={newActionTrigger}
          onChangeName={setNewActionName}
          onChangeTrigger={setNewActionTrigger}
          onSubmit={handleAddAction}
          onCancel={() => setShowAddAction(false)}
        />
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
      {/* AI 差分プレビューダイアログ (Phase-3 で ProcessFlowDialogs に統合) */}
    </div>
  );
}

// ── browser-first 処理フロー変異ヘルパー ───────────────────────────────────
// #1149 (PR #1148 follow-up) で `./processFlowMutation.ts` に切り出し済。
// 切り出し理由: vitest unit test で巨大エディタ全体を巻き込まずに mutation
// ロジックを単体検証するため。v3 構造 (`kind` discriminator / RFC 4122 v4
// UUID) は同モジュール内で受容する。
