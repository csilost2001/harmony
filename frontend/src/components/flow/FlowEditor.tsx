import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  addEdge as rfAddEdge,
  reconnectEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ConnectionMode,
  type Connection,
  type Edge as RFEdge,
  type Node as RFNode,
  type NodeMouseHandler,
  MarkerType,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import ScreenNodeComponent from "./ScreenNode";
import GroupNodeComponent from "./GroupNodeComponent";
import { FlowSubToolbar } from "./FlowSubToolbar";
import { FlowMarkerPanel } from "./FlowMarkerPanel";
import { ScreenEditModal, type ScreenFormData } from "./ScreenEditModal";
import { EdgeEditModal, type EdgeFormData, type HandlePosition } from "./EdgeEditModal";
import type { FlowProject, ScreenNode, ScreenEdge, ScreenGroup } from "../../types/flow";
import type { Screen } from "../../types/v3/screen";
import type { Marker } from "../../types/v3/common";
import type { PageLayoutEntry } from "../../types/v3/harmony";
import { TRIGGER_LABELS } from "../../types/flow";
import type { ScreenGroupId, ScreenKind, ScreenFlowPositions, Timestamp, PageLayoutId } from "../../types/v3";
import {
  loadProject,
  loadRawProject,
  saveProject,
  persistProject,
  addScreen,
  updateScreen,
  removeScreen,
  addEdge as storeAddEdge,
  updateEdge as storeUpdateEdge,
  removeEdge as storeRemoveEdge,
  addGroup as storeAddGroup,
  updateGroup as storeUpdateGroup,
  removeGroup as storeRemoveGroup,
  exportProjectJSON,
  importProjectJSON,
  generateMermaid,
  generateFlowMarkdown,
} from "../../store/flowStore";
import { buildDefaultScreen, loadScreenEntity, saveScreenEntity } from "../../store/screenStore";
import { listPageLayouts } from "../../store/pageLayoutStore";
import { clearScreenFlowPositionsPreview, saveScreenFlowPositionsPreview } from "../../store/screenFlowPositionsStore";
import { duplicateScreenDesignData } from "../../store/duplicateScreen";
import { makeDuplicatedEntityId } from "../../utils/entityIdSuggestion";
import { resolveEditorKind } from "../../utils/resolveEditorKind";
import { resolveCssFramework } from "../../utils/resolveCssFramework";
import { RenameEntityDialog } from "../common/RenameEntityDialog";
import { RenameEntityUndoToast } from "../common/RenameEntityUndoToast";
import { useRenameEntityUndoToast } from "../common/useRenameEntityUndoToast";
import { handleRenameSuccess } from "../../utils/handleRenameSuccess";
import { useUndoKeyboard } from "../../hooks/useUndoKeyboard";
import { useSaveShortcut } from "../../hooks/useSaveShortcut";
import { useFlowProjectSync } from "../../hooks/useFlowProjectSync";
import { useEditSession } from "../../hooks/useEditSession";
import { useSessionUrlSync } from "../../hooks/useSessionUrlSync";
import { EditModeToolbar } from "../editing/EditModeToolbar";
import { EditSessionDropdown } from "../editing/EditSessionDropdown";
import {
  DiscardConfirmDialog,
  ForceReleaseConfirmDialog,
  ForcedOutChoiceDialog,
  AfterForceUnlockChoiceDialog,
} from "../editing/ConfirmDialogs";
import { SaveConflictDialog } from "../editing/SaveConflictDialog";
import { ResumeOrDiscardDialog } from "../editing/ResumeOrDiscardDialog";
import { mcpBridge } from "../../mcp/mcpBridge";
import { openTab, makeTabId, setDirty as setTabDirty } from "../../store/tabStore";
import { ServerChangeBanner } from "../common/ServerChangeBanner";
import { useErrorDialog } from "../common/ErrorDialogProvider";
import { acknowledgeServerMtime } from "../../utils/serverMtime";
import "../../styles/flow.css";
import "../../styles/editMode.css";

const nodeTypes = {
  screenNode: ScreenNodeComponent,
  groupNode: GroupNodeComponent,
};

function toRFNodesWithGroups(
  screens: ScreenNode[],
  groups: ScreenGroup[],
  screenEntities?: Map<string, Screen>,
): RFNode[] {
  // Group nodes must come first so ReactFlow knows about parents before children
  const groupNodes: RFNode[] = (groups ?? []).map((g) => ({
    id: g.id,
    type: "groupNode",
    position: g.position,
    style: { width: g.size.width, height: g.size.height },
    data: { ...g },
    zIndex: -1,
    selectable: true,
    draggable: true,
  }));

  const screenNodes: RFNode[] = screens.map((s) => {
    const entity = screenEntities?.get(s.id);
    const unresolvedCount = entity
      ? (entity.authoring?.markers ?? []).filter((m) => !m.resolvedAt).length
      : 0;
    const node: RFNode = {
      id: s.id,
      type: "screenNode",
      position: s.position,
      data: { ...s, unresolvedCount },
    };
    if (s.groupId) {
      node.parentId = s.groupId;
      node.extent = "parent";
    }
    return node;
  });

  return [...groupNodes, ...screenNodes];
}

function toRFEdges(edges: ScreenEdge[]): RFEdge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    label: e.label || (TRIGGER_LABELS[e.trigger] ?? ""),
    reconnectable: true,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: { strokeWidth: 2, stroke: "#94a3b8" },
    labelStyle: { fontSize: 11, fill: "#475569" },
    labelBgStyle: { fill: "#fff", fillOpacity: 0.9 },
    labelBgPadding: [6, 4] as [number, number],
    labelBgBorderRadius: 4,
  }));
}

function toScreenFlowPositionsPreview(project: FlowProject): Pick<ScreenFlowPositions, "positions"> {
  const positions: ScreenFlowPositions["positions"] = {};
  for (const screen of project.screens) {
    positions[screen.id] = screen.position;
  }
  for (const group of project.groups ?? []) {
    positions[group.id] = group.position;
  }
  return { positions };
}

interface ContextMenu {
  x: number;
  y: number;
  type: "node" | "group" | "edge";
  targetId: string;
}

function FlowEditorInner() {
  const navigate = useNavigate();
  const { wsPath, wsId } = useWorkspacePath();
  // #1388 sub-section B (case A): projectRef を useState 化。旧 `projectRef.current` JSX access が
  // react-hooks/refs 警告 14 件を発生させていた根本原因 — render-time の ref read は React 19 /
  // React Compiler / eslint-plugin-react-hooks 7.x で不正動作 (再 render trigger 漏れ) を起こすため。
  //
  // **mutation pattern (実装の実態)**: store 関数 (`updateScreen` / `addScreen` / `storeAddEdge` 等) は
  // in-place mutation API のまま保持し、各 callback で `await storeFunc(project, ...)` を call する形式を
  // 継続する。これは React state を直接 mutation する pattern (anti-React-canonical) だが、以下の理由で
  // 機能的には正しく動作する:
  //
  // 1. mutation 後の visible reads (setNodes 内の `project.screens.find(...)` 等) は同 reference 経由で
  //    最新値を読める
  // 2. 各 mutation callback は必ず setNodes / setEdges / setProjectName 等の併発 setState を伴うため、
  //    React re-render が trigger され consumer JSX (`existingScreenIds={project.screens.map(...)}` 等) は
  //    次 render で mutation を反映する
  // 3. handleUndo / handleRedo / reloadProject / handleImportJSON / handleRenameProject は新 reference
  //    で setProject() するため、これらは正規の React state 更新として動作する
  //
  // 完全に React-canonical な immutable update への移行は store 関数 API (~26 関数) の signature 変更を
  // 要し、本 PR scope を超える別 refactor (本コメント時点では別 ISSUE 起票も予定なし、必要性が顕在化
  // した時点で判断)。eslint の `react-hooks/immutability` rule は `state.field = X` 直接代入のみを検出
  // するため、`handleRenameProject` (旧 `project.name = X`) のみは immutable update に rewrite して
  // 警告解消済 (本 PR の commit 7e2bdc55)。
  //
  // 全 callback の deps に `project` を加える (= callback 再生成許容、cost 不問前提)。
  const [project, setProject] = useState<FlowProject | null>(null);
  const { fitView, zoomTo } = useReactFlow();
  const { showError } = useErrorDialog();

  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const [projectName, setProjectName] = useState("読み込み中...");
  const [isLoading, setIsLoading] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isDirtyRef = useRef(false);
  const needsFitViewRef = useRef(false);

  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showForceReleaseDialog, setShowForceReleaseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);

  // ── マーカーパネル ──
  const [markerPanelOpen, setMarkerPanelOpen] = useState(false);
  const [screenEntities, setScreenEntities] = useState<Map<string, Screen>>(new Map());
  // useCallback 内から最新 screenEntities を参照するための ref
  const screenEntitiesRef = useRef<Map<string, Screen>>(new Map());
  useEffect(() => { screenEntitiesRef.current = screenEntities; }, [screenEntities]);

  const sessionId = mcpBridge.getSessionId();

  // URL ?session= 同期 (spec §11.2) — initialEditSessionId を useEditSession に渡すため先に呼ぶ
  const { initialEditSessionId: initialFlowSessionId, syncSessionToUrl } = useSessionUrlSync({
    resourceType: "flow",
    resourceId: "singleton",
  });

  // P2-2 fix (#907): URL ?session= から復元した initialEditSessionId を渡す (URL 招待 attach 復活)
  const { editSession, mode, loading: sessionLoading, isDirtyForTab, actions, attach, takeOver, saveCheckConflict, saveCommit, saveConflict, onSaveConflictCancel } = useEditSession({
    resourceType: "flow",
    resourceId: "singleton",
    sessionId,
    editSessionId: initialFlowSessionId,
  });

  const isReadonly = mode.kind !== "editing";

  // Undo/Redo スタック
  const undoStackRef = useRef<FlowProject[]>([]);
  const redoStackRef = useRef<FlowProject[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushUndoSnapshot = useCallback(() => {
    if (!project) return;
    undoStackRef.current = [...undoStackRef.current, JSON.parse(JSON.stringify(project))].slice(-50);
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [project]);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0 || !project) return;
    redoStackRef.current = [...redoStackRef.current, JSON.parse(JSON.stringify(project))];
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    setProject(prev);
    // purpose='gadget' は画面遷移図に表示しない (pl-4, #1025)
    setNodes(toRFNodesWithGroups(prev.screens.filter((s) => s.purpose !== "gadget"), prev.groups ?? [], screenEntitiesRef.current));
    setEdges(toRFEdges(prev.edges));
    setProjectName(prev.name);
    saveProject(prev).catch(console.error);
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
  }, [project, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0 || !project) return;
    undoStackRef.current = [...undoStackRef.current, JSON.parse(JSON.stringify(project))];
    const next = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    setProject(next);
    // purpose='gadget' は画面遷移図に表示しない (pl-4, #1025)
    setNodes(toRFNodesWithGroups(next.screens.filter((s) => s.purpose !== "gadget"), next.groups ?? [], screenEntitiesRef.current));
    setEdges(toRFEdges(next.edges));
    setProjectName(next.name);
    saveProject(next).catch(console.error);
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  }, [project, setNodes, setEdges]);

  useUndoKeyboard(handleUndo, handleRedo, !isReadonly);

  // project.techStack.designer の project default (画面作成ダイアログのデフォルト選択値)
  // #1379: react-hooks/immutability — `reloadProject` (後続 useCallback) が
  // setProjectDefaultEditorKind / setProjectDefaultCssFramework を closure で参照するため、
  // setter 宣言を `reloadProject` より物理的に前に移動する (TDZ forward reference 解消)。
  const [projectDefaultEditorKind, setProjectDefaultEditorKind] = useState<"grapesjs" | "puck">("grapesjs");
  const [projectDefaultCssFramework, setProjectDefaultCssFramework] = useState<"bootstrap" | "tailwind">("bootstrap");

  // プロジェクトを読み込んで UI に反映
  // #1388 case A: local var 名 `project` は state 名と衝突するため `loaded` に rename。
  const reloadProject = useCallback(async () => {
    const [loaded, raw] = await Promise.all([loadProject(), loadRawProject()]);
    setProject(loaded);
    // purpose='gadget' は画面遷移図に表示しない (pl-4, #1025)
    const pageScreens = loaded.screens.filter((s) => s.purpose !== "gadget");
    setNodes(toRFNodesWithGroups(pageScreens, loaded.groups ?? [], screenEntitiesRef.current));
    setEdges(toRFEdges(loaded.edges));
    setProjectName(loaded.name);
    setProjectDefaultEditorKind(resolveEditorKind(undefined, raw.techStack));
    setProjectDefaultCssFramework(resolveCssFramework(undefined, raw.techStack));
    needsFitViewRef.current = pageScreens.length > 0;
    setIsLoading(false);
    setIsDirty(false);
    isDirtyRef.current = false;
  }, [setNodes, setEdges]);

  // ロード完了 or ノード変更後に全体フィット
  useEffect(() => {
    if (!isLoading && needsFitViewRef.current && nodes.length > 0) {
      needsFitViewRef.current = false;
      requestAnimationFrame(() => {
        fitView({ padding: 0.3, maxZoom: 1, duration: 200 });
      });
    }
  }, [isLoading, nodes, fitView]);

  const { serverChanged, dismissServerBanner, markExternalChangeForBanner } = useFlowProjectSync({
    reload: reloadProject,
    isDirtyRef,
    setIsDirty,
    navigate,
  });

  // Phase H SF-2 (Opus round 2 独立レビュー、#1298 I-6): rename / 関連 entity 変更の
  // broadcast を購読し、画面フロー図を最新化する。`useFlowProjectSync` は projectChanged のみ
  // 購読しているため、Screen / Table / ProcessFlow / PageLayout rename (entity 別 broadcast)
  // を受信せず stale 表示になっていた。
  //
  // Phase I round 3+4 SF-2 (Codex round 3 S-2 / round 4 S-2): 旧実装は dirty 中は単に return
  // していたため、ServerChangeBanner が立たず競合通知を見逃していた (useFlowProjectSync の
  // banner は projectChanged のみ購読)。本 phase で dirty 中も serverChanged 経路を発火する
  // 共通 handler を呼び出すように修正。
  useEffect(() => {
    const handleExternalChange = () => {
      if (isDirtyRef.current) {
        // dirty: banner で通知 (useFlowProjectSync 内の serverChanged 状態を立てる)
        markExternalChangeForBanner();
      } else {
        // clean: 自動 reload
        reloadProject().catch(console.error);
      }
    };
    const unsubScreen = mcpBridge.onBroadcast("screenChanged", handleExternalChange);
    const unsubTable = mcpBridge.onBroadcast("tableChanged", handleExternalChange);
    const unsubProcessFlow = mcpBridge.onBroadcast("processFlowChanged", handleExternalChange);
    const unsubPageLayout = mcpBridge.onBroadcast("pageLayoutChanged", handleExternalChange);
    return () => {
      unsubScreen();
      unsubTable();
      unsubProcessFlow();
      unsubPageLayout();
    };
  }, [reloadProject, isDirtyRef, markExternalChangeForBanner]);

  // タブ dirty マーク
  useEffect(() => {
    const tabId = makeTabId("screen-flow", "main");
    setTabDirty(tabId, isDirtyForTab || isDirty);
  }, [isDirtyForTab, isDirty]);

  // 復元ダイアログ (readonly + draft 存在時)
  useEffect(() => {
    if (sessionLoading) return;
    if (mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      const res = await mcpBridge.request("editSession.list", { resourceType: "flow", resourceId: "singleton" }) as { sessions: Array<{ state?: string; participants?: Record<string, unknown> }> } | null;
      if (cancelled) return;
      // #980-A: 自分が participant として参加していた Active session のみ対象。
      const mySessionId = mcpBridge.getSessionId();
      const hasMyActiveSession = (res?.sessions ?? []).some((s) =>
        s.state === "Active" && !!s.participants?.[mySessionId],
      );
      if (hasMyActiveSession) setShowResumeDialog(true);
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [sessionLoading, mode.kind]);

  // (projectDefaultEditorKind / projectDefaultCssFramework は #1379 の TDZ 解消で上方移動済み)
  // pageLayoutId 選択 dropdown 用 (pl-4, #1025)
  const [pageLayouts, setPageLayouts] = useState<PageLayoutEntry[]>([]);

  // Modals
  const [screenModal, setScreenModal] = useState<{
    open: boolean;
    editId?: string;
    initial?: Partial<ScreenFormData>;
  }>({ open: false });
  const [edgeModal, setEdgeModal] = useState<{
    open: boolean;
    editId?: string;
    initial?: Partial<EdgeFormData>;
  }>({ open: false });

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  // #1330: ScreenFlow node 右クリック起点の Screen rename refactor。
  // 完了後は ScreenFlow に留まる (singleton 起動)。
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  // Codex Round 1 Should-fix: rename 成功時 setRenameTarget(null) で `currentId` が空文字に
  // なり useRenameEntityUndoToast の key 切替で toast が即時 clear される race を回避するため、
  // toast 用に新 id (= rename 後 id) を保持する独立 state を用意する。
  const [renamedToastNewId, setRenamedToastNewId] = useState<string>("");
  const [renameUndoToast, setRenameUndoToast] = useRenameEntityUndoToast(
    "screen",
    renamedToastNewId,
    wsId,
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  // PageLayout 一覧をロード (pageLayoutId 選択 dropdown 用, pl-4, #1025)
  useEffect(() => {
    listPageLayouts().then(setPageLayouts).catch(console.error);
  }, []);

  // ノード位置変更時の保存デバウンス
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncAndSave = useCallback(() => {
    if (!project) return;
    saveScreenFlowPositionsPreview(toScreenFlowPositionsPreview(project));
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      if (project) {
        if (!isReadonly) {
          saveProject(project).catch(console.error);
          // ドラフト更新 (edit-session-draft)
          if (editSession?.id) {
            mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: project }).catch(console.error);
          }
        }
      }
    }, 300);
  }, [project, isReadonly, editSession]);

  const onNodeDragStop = useCallback((_: unknown, node: RFNode) => {
    if (!project) return;
    const screen = project.screens.find((s) => s.id === node.id);
    if (screen) {
      screen.position = node.position;
      syncAndSave();
      return;
    }
    const group = (project.groups ?? []).find((g) => g.id === node.id);
    if (group) {
      group.position = node.position;
      syncAndSave();
    }
  }, [project, syncAndSave]);

  const onConnect = useCallback((connection: Connection) => {
    if (isReadonly || !connection.source || !connection.target || !project) return;
    pushUndoSnapshot();
    storeAddEdge(
      project,
      connection.source,
      connection.target,
      "",
      "click",
      connection.sourceHandle ?? undefined,
      connection.targetHandle ?? undefined,
    ).then((edge) => {
      setEdges((eds) => rfAddEdge({
        ...connection,
        id: edge.id,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: { strokeWidth: 2, stroke: "#94a3b8" },
        labelStyle: { fontSize: 11, fill: "#475569" },
        labelBgStyle: { fill: "#fff", fillOpacity: 0.9 },
        labelBgPadding: [6, 4] as [number, number],
        labelBgBorderRadius: 4,
      }, eds));
    }).catch(console.error);
    // #1388 Codex Round 1 Must-fix: project / pushUndoSnapshot を deps に追加し旧
    // eslint suppression directive を削除した。useRef 時代は `projectRef.current` が常に最新値を
    // 返すため deps から外せたが、useState 化後は closure capture pattern になるため deps 必須。
    // 初回 render で project===null を捕捉すると以降の接続作成が常に no-op になる regression。
  }, [project, isReadonly, setEdges, pushUndoSnapshot]);

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === "screenNode") {
      const screenName = (node.data as { name?: string }).name ?? node.id;
      openTab({ id: makeTabId("design", node.id), type: "design", resourceId: node.id, label: screenName });
    }
    navigate(wsPath(`/screen/design/${node.id}`));
  }, [navigate, wsPath]);

  const onNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
    event.preventDefault();
    const type = node.type === "groupNode" ? "group" : "node";
    setContextMenu({ x: event.clientX, y: event.clientY, type, targetId: node.id });
  }, []);

  const onEdgeContextMenu = useCallback((event: React.MouseEvent, edge: RFEdge) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, type: "edge", targetId: edge.id });
  }, []);

  const onEdgeDoubleClick = useCallback((_event: React.MouseEvent, edge: RFEdge) => {
    if (!project) return;
    const storeEdge = project.edges.find((e) => e.id === edge.id);
    if (storeEdge) {
      setEdgeModal({
        open: true,
        editId: edge.id,
        initial: {
          label: storeEdge.label,
          trigger: storeEdge.trigger,
          sourceHandle: (storeEdge.sourceHandle ?? "bottom") as HandlePosition,
          targetHandle: (storeEdge.targetHandle ?? "top") as HandlePosition,
        },
      });
    }
  }, [project]);

  // ── Screen Modal Actions ──

  const handleOpenAddScreen = useCallback(() => {
    if (isReadonly) return;
    setScreenModal({ open: true });
  }, [isReadonly]);

  const handleScreenSave = useCallback(async (data: ScreenFormData) => {
    if (!project) return;
    pushUndoSnapshot();
    if (screenModal.editId) {
      await updateScreen(project, screenModal.editId, {
        name: data.name,
        kind: data.type as ScreenKind,
        path: data.path,
        description: data.description,
        // pageLayoutId 更新 (purpose='page' のみ意味を持つ, pl-4, #1025)
        pageLayoutId: (data.pageLayoutId || undefined) as (PageLayoutId | undefined),
      });
      setNodes((nds) => nds.map((n) => {
        if (n.id !== screenModal.editId || !project) return n;
        const screen = project.screens.find((s) => s.id === n.id)!;
        return { ...n, data: { ...screen } };
      }));
    } else {
      const editorKind = data.editorKind ?? projectDefaultEditorKind;
      const cssFramework = data.cssFramework ?? projectDefaultCssFramework;
      // RFC #1284 / #1297 I-5: kebab-case id を modal から受け取って addScreen に渡す
      const screen = await addScreen(project, data.name, data.type as ScreenKind, { path: data.path, editorKind, cssFramework, id: data.id });
      screen.description = data.description;
      await saveProject(project);
      // screen.design に editorKind/cssFramework を明示書き込み (spec § 2.5.2)
      const entity = await buildDefaultScreen(screen.id);
      entity.design = { ...entity.design, editorKind, cssFramework };
      await saveScreenEntity(entity);
      setNodes((nds) => [...nds, {
        id: screen.id,
        type: "screenNode" as const,
        position: screen.position,
        data: { ...screen },
      }]);
    }
    setScreenModal({ open: false });
  }, [project, screenModal.editId, projectDefaultEditorKind, projectDefaultCssFramework, setNodes, pushUndoSnapshot]);

  // ── Edge Modal Actions ──

  const handleEdgeSave = useCallback(async (data: EdgeFormData) => {
    if (!edgeModal.editId || !project) return;
    pushUndoSnapshot();
    await storeUpdateEdge(project, edgeModal.editId, {
      label: data.label,
      trigger: data.trigger,
      sourceHandle: data.sourceHandle,
      targetHandle: data.targetHandle,
    });
    setEdges((eds) => eds.map((e) => {
      if (e.id !== edgeModal.editId) return e;
      return {
        ...e,
        label: data.label || (TRIGGER_LABELS[data.trigger] ?? ""),
        sourceHandle: data.sourceHandle,
        targetHandle: data.targetHandle,
      };
    }));
    setEdgeModal({ open: false });
  }, [project, edgeModal.editId, setEdges, pushUndoSnapshot]);

  const handleEdgeDeleteFromModal = useCallback(async () => {
    if (!edgeModal.editId || !project) return;
    await storeRemoveEdge(project, edgeModal.editId);
    setEdges((eds) => eds.filter((e) => e.id !== edgeModal.editId));
    setEdgeModal({ open: false });
  }, [project, edgeModal.editId, setEdges]);

  // ── Context Menu Actions ──

  const handleEditNode = useCallback(() => {
    if (!contextMenu || !project) return;
    const screen = project.screens.find((s) => s.id === contextMenu.targetId);
    if (screen) {
      setScreenModal({
        open: true,
        editId: screen.id,
        initial: {
          name: screen.name,
          type: screen.kind,
          path: screen.path,
          description: screen.description,
          pageLayoutId: screen.pageLayoutId ? String(screen.pageLayoutId) : undefined,
        },
      });
    }
    setContextMenu(null);
  }, [project, contextMenu]);

  const handleDuplicateNode = useCallback(async () => {
    if (!contextMenu || !project) return;
    pushUndoSnapshot();
    const screen = project.screens.find((s) => s.id === contextMenu.targetId);
    if (screen) {
      // コピー元の editorKind/cssFramework を継承する (spec § 2.5.2: 作成時固定)
      const srcEntity = await loadScreenEntity(screen.id);
      const srcEditorKind = resolveEditorKind(srcEntity.design, undefined);
      const srcCssFramework = resolveCssFramework(srcEntity.design, undefined);
      // RFC #1284 / #1329: duplicate 経路でも kebab-case id を発番する。
      // 元 id + `-copy[-N]` で uniqueness 衝突回避 (TableListView duplicate と同パターン)。
      const existingIds = new Set<string>(project.screens.map((s) => s.id));
      const newId = makeDuplicatedEntityId(screen.id, existingIds);
      const dup = await addScreen(
        project,
        `${screen.name} (コピー)`,
        screen.kind,
        {
          id: newId,
          path: screen.path,
          position: { x: screen.position.x + 30, y: screen.position.y + 30 },
          editorKind: srcEditorKind,
          cssFramework: srcCssFramework,
        },
      );
      dup.description = screen.description;
      await saveProject(project);
      // screen.design に editorKind/cssFramework を明示書き込み (spec § 2.5.2)
      const dupEntity = await buildDefaultScreen(dup.id);
      dupEntity.design = { ...dupEntity.design, editorKind: srcEditorKind, cssFramework: srcCssFramework };
      await saveScreenEntity(dupEntity);
      await duplicateScreenDesignData(screen.id, dup.id, srcEditorKind);
      setNodes((nds) => [...nds, {
        id: dup.id,
        type: "screenNode" as const,
        position: dup.position,
        data: dup as unknown as RFNode["data"],
      }]);
    }
    setContextMenu(null);
  }, [project, contextMenu, setNodes, pushUndoSnapshot]);

  const handleDeleteNode = useCallback(async () => {
    if (!contextMenu || !project) return;
    pushUndoSnapshot();
    const screen = project.screens.find((s) => s.id === contextMenu.targetId);
    if (screen && confirm(`「${screen.name}」を削除しますか？\nデザインデータも削除されます。`)) {
      await removeScreen(project, contextMenu.targetId);
      setNodes((nds) => nds.filter((n) => n.id !== contextMenu.targetId));
      setEdges((eds) => eds.filter(
        (e) => e.source !== contextMenu.targetId && e.target !== contextMenu.targetId
      ));
    }
    setContextMenu(null);
  }, [project, contextMenu, setNodes, setEdges, pushUndoSnapshot]);

  const handleDesignNode = useCallback(() => {
    if (!contextMenu) return;
    const screenId = contextMenu.targetId;
    const screenName = nodes.find((n) => n.id === screenId)?.data
      ? ((nodes.find((n) => n.id === screenId)!.data as { name?: string }).name ?? screenId)
      : screenId;
    openTab({ id: makeTabId("design", screenId), type: "design", resourceId: screenId, label: screenName });
    navigate(wsPath(`/screen/design/${screenId}`));
    setContextMenu(null);
  }, [contextMenu, navigate, nodes, wsPath]);

  // #1330: ScreenFlow 起点 Screen rename refactor 起動 (context menu item)。
  const handleRenameNode = useCallback(() => {
    if (!contextMenu || !project) return;
    const screen = project.screens.find((s) => s.id === contextMenu.targetId);
    if (screen) {
      setRenameTarget({ id: screen.id, name: screen.name });
    }
    setContextMenu(null);
  }, [project, contextMenu]);

  // ── Marker Panel Actions ──

  /** panel を開く時だけ全 screen entity を lazy load */
  const handleToggleMarkerPanel = useCallback(async () => {
    const opening = !markerPanelOpen;
    setMarkerPanelOpen(opening);
    if (opening && project) {
      const map = new Map<string, Screen>();
      await Promise.all(
        project.screens.map(async (s) => {
          try {
            const entity = await loadScreenEntity(s.id);
            map.set(s.id, entity);
          } catch {
            // 読み込み失敗時はスキップ (ghost screen)
          }
        }),
      );
      setScreenEntities(map);
    }
  }, [project, markerPanelOpen]);

  /** marker 追加/解決/削除時に screen entity を更新して保存 */
  const handleMarkerChange = useCallback(
    async (screenId: string, updatedMarkers: Marker[]) => {
      // Should-fix #1003: panel open 後に追加された画面は screenEntities に未登録の場合があるため
      // entity が無ければ on-demand で load して Map に追加する (silent fail 防止)
      let entity = screenEntities.get(screenId);
      if (!entity) {
        try {
          entity = await loadScreenEntity(screenId);
          setScreenEntities((prev) => {
            const next = new Map(prev);
            next.set(screenId, entity!);
            return next;
          });
        } catch {
          // ghost screen (entity ファイルが存在しない) の場合はスキップ
          return;
        }
      }
      const updated: Screen = {
        ...entity,
        authoring: {
          ...(entity.authoring ?? {}),
          markers: updatedMarkers.length > 0 ? updatedMarkers : undefined,
        },
      };
      await saveScreenEntity(updated);
      setScreenEntities((prev) => {
        const next = new Map(prev);
        next.set(screenId, updated);
        return next;
      });
    },
    [screenEntities],
  );

  // ── Group Actions ──

  const handleAddGroup = useCallback(async () => {
    if (!project) return;
    const name = prompt("グループ名を入力してください", "グループ");
    if (!name) return;
    const group = await storeAddGroup(project, name.trim(), { x: 80, y: 80 });
    setNodes((nds) => [{
      id: group.id,
      type: "groupNode",
      position: group.position,
      style: { width: group.size.width, height: group.size.height },
      data: { ...group },
      zIndex: -1,
      selectable: true,
      draggable: true,
    }, ...nds]);
  }, [project, setNodes]);

  const handleRenameGroup = useCallback(async () => {
    if (!contextMenu || !project) return;
    const group = (project.groups ?? []).find((g) => g.id === contextMenu.targetId);
    if (!group) return;
    const name = prompt("新しいグループ名を入力してください", group.name);
    if (!name || name.trim() === group.name) { setContextMenu(null); return; }
    await storeUpdateGroup(project, group.id, { name: name.trim() });
    setNodes((nds) => nds.map((n) =>
      n.id === group.id ? { ...n, data: { ...n.data, name: name.trim() } } : n
    ));
    setContextMenu(null);
  }, [project, contextMenu, setNodes]);

  const handleDeleteGroup = useCallback(async () => {
    if (!contextMenu || !project) return;
    const group = (project.groups ?? []).find((g) => g.id === contextMenu.targetId);
    if (!group) return;
    if (!confirm(`グループ「${group.name}」を削除しますか？\n（画面はグループから外れますが削除されません）`)) {
      setContextMenu(null);
      return;
    }
    await storeRemoveGroup(project, contextMenu.targetId);
    setNodes(toRFNodesWithGroups(project.screens, project.groups ?? [], screenEntitiesRef.current));
    setContextMenu(null);
  }, [project, contextMenu, setNodes]);

  const handleAssignGroup = useCallback(async (groupId: ScreenGroupId) => {
    if (!contextMenu || !project) return;
    const screen = project.screens.find((s) => s.id === contextMenu.targetId);
    const group = (project.groups ?? []).find((g) => g.id === groupId);
    if (!screen || !group) return;
    // Convert absolute position to relative within the group
    const absPos = screen.groupId
      ? (() => {
          const cur = (project!.groups ?? []).find((g) => g.id === screen.groupId);
          return cur
            ? { x: screen.position.x + cur.position.x, y: screen.position.y + cur.position.y }
            : screen.position;
        })()
      : screen.position;
    screen.position = {
      x: Math.max(10, absPos.x - group.position.x),
      y: Math.max(32, absPos.y - group.position.y),
    };
    screen.groupId = groupId;
    screen.updatedAt = new Date().toISOString() as Timestamp;
    await saveProject(project);
    setNodes(toRFNodesWithGroups(project.screens, project.groups ?? [], screenEntitiesRef.current));
    setContextMenu(null);
  }, [project, contextMenu, setNodes]);

  const handleUnassignGroup = useCallback(async () => {
    if (!contextMenu || !project) return;
    const screen = project.screens.find((s) => s.id === contextMenu.targetId);
    if (!screen || !screen.groupId) return;
    const group = (project.groups ?? []).find((g) => g.id === screen.groupId);
    if (group) {
      screen.position = {
        x: screen.position.x + group.position.x,
        y: screen.position.y + group.position.y,
      };
    }
    screen.groupId = undefined;
    screen.updatedAt = new Date().toISOString() as Timestamp;
    await saveProject(project);
    setNodes(toRFNodesWithGroups(project.screens, project.groups ?? [], screenEntitiesRef.current));
    setContextMenu(null);
  }, [project, contextMenu, setNodes]);

  // ── Edge Context Menu Actions ──

  const handleEditEdge = useCallback(() => {
    if (!contextMenu || contextMenu.type !== "edge" || !project) return;
    const storeEdge = project.edges.find((e) => e.id === contextMenu.targetId);
    if (storeEdge) {
      setEdgeModal({
        open: true,
        editId: storeEdge.id,
        initial: {
          label: storeEdge.label,
          trigger: storeEdge.trigger,
          sourceHandle: (storeEdge.sourceHandle ?? "bottom") as HandlePosition,
          targetHandle: (storeEdge.targetHandle ?? "top") as HandlePosition,
        },
      });
    }
    setContextMenu(null);
  }, [project, contextMenu]);

  const handleDeleteEdge = useCallback(async () => {
    if (!contextMenu || contextMenu.type !== "edge" || !project) return;
    pushUndoSnapshot();
    await storeRemoveEdge(project, contextMenu.targetId);
    setEdges((eds) => eds.filter((e) => e.id !== contextMenu.targetId));
    setContextMenu(null);
  }, [project, contextMenu, setEdges, pushUndoSnapshot]);

  // ドラッグによるエッジ端点の付け替え
  const onReconnect = useCallback((oldEdge: RFEdge, newConnection: Connection) => {
    setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds));
    if (!project) return;
    storeUpdateEdge(project, oldEdge.id, {
      sourceHandle: (newConnection.sourceHandle ?? oldEdge.sourceHandle ?? "bottom") as HandlePosition,
      targetHandle: (newConnection.targetHandle ?? oldEdge.targetHandle ?? "top") as HandlePosition,
    }).catch(console.error);
  }, [project, setEdges]);

  const onEdgesDelete = useCallback((deletedEdges: RFEdge[]) => {
    if (!project) return;
    Promise.all(deletedEdges.map((e) => storeRemoveEdge(project!, e.id)))
      .catch(console.error);
  }, [project]);

  const onNodesDelete = useCallback((deletedNodes: RFNode[]) => {
    if (!project) return;
    const promises = deletedNodes.map((n) => {
      if (project.screens.find((s) => s.id === n.id)) {
        return removeScreen(project, n.id);
      }
      if ((project.groups ?? []).find((g) => g.id === n.id)) {
        return storeRemoveGroup(project, n.id).then(() => {
          // Rebuild nodes to reflect ungrouped screens (#1388 case A:
          // project は state、store 関数の in-place mutation 後も同 reference のため再描画は setNodes で trigger)
          setNodes(toRFNodesWithGroups(project.screens, project.groups ?? [], screenEntitiesRef.current));
          return true;
        });
      }
      return Promise.resolve(false);
    });
    Promise.all(promises).catch(console.error);
  }, [project, setNodes]);

  // ── Project-level Actions ──

  const handleRenameProject = useCallback(async (name: string) => {
    if (!project) return;
    // #1388 case A: state を直接 mutation せず、immutable update + setProject で更新
    const updated = { ...project, name };
    setProject(updated);
    await saveProject(updated);
    setProjectName(name);
  }, [project]);

  const handleClearAll = useCallback(async () => {
    if (!project) return;
    if (!confirm("すべての画面と遷移を削除しますか？\n各画面のデザインデータも削除されます。")) return;
    // スナップショットを取ってから削除（removeScreen が配列を変更するため）
    for (const s of [...project.screens]) {
      await removeScreen(project, s.id).catch(console.error);
    }
    setNodes([]);
    setEdges([]);
  }, [project, setNodes, setEdges]);

  // ── ファイル操作 ──

  const handleExportJSON = useCallback(() => {
    if (!project) return;
    const json = exportProjectJSON(project);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name || "flow-project"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [project]);

  const handleImportJSON = useCallback(async (json: string) => {
    try {
      const imported = await importProjectJSON(json);
      setProject(imported);
      setNodes(toRFNodesWithGroups(imported.screens, imported.groups ?? [], screenEntitiesRef.current));
      setEdges(toRFEdges(imported.edges));
      setProjectName(imported.name);
      needsFitViewRef.current = imported.screens.length > 0;
    } catch (e) {
      showError({
        title: "プロジェクトのインポートに失敗しました",
        error: e,
      });
    }
  }, [setNodes, setEdges, showError]);

  const handleZoomChange = useCallback((zoom: number) => {
    const clamped = Math.min(2, Math.max(0.25, zoom));
    zoomTo(clamped, { duration: 150 });
  }, [zoomTo]);

  const handleFitView = useCallback(() => {
    fitView({ padding: 0.3, maxZoom: 1, duration: 200 });
  }, [fitView]);

  const handleCopyMermaid = useCallback(() => {
    if (!project) return;
    const mermaid = generateMermaid(project);
    navigator.clipboard.writeText(mermaid).then(
      () => alert("Mermaid 記法をクリップボードにコピーしました"),
      (e) => showError({
        title: "クリップボードへのコピーに失敗しました",
        error: e,
        message: e instanceof Error ? e.message : "ブラウザがクリップボードへのアクセスを拒否した可能性があります。",
      }),
    );
  }, [project, showError]);

  const handleExportMarkdown = useCallback(() => {
    if (!project) return;
    const md = generateFlowMarkdown(project);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.name || "flow-project"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [project]);

  const handleSave = useCallback(async () => {
    if (!project || isSaving || isReadonly) return;
    // pending debounce があればキャンセルして即 flush
    // 編集開始直後に保存した場合 draft が空のまま commitDraft に到達してゾンビロックになるのを防ぐ
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = null;
    }
    if (editSession?.id) {
      await mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: project });
    }
    setIsSaving(true);
    try {
      // P2 fix (#912): 2 段階保存。flow は backend editSession.save で本体書き込みを skip し、
      // 代わりに frontend persistProject() が harmony.json + screen-flow-positions.json を書く設計のため、
      // saveHistory 記録が persist 失敗時に先行記録される問題を解消するため checkOnly → persist → commit の順で実行する。
      const checkResult = await saveCheckConflict();
      if (checkResult.conflicted || checkResult.failed) return;
      await persistProject(project);
      const commitResult = await saveCommit();
      if (commitResult.failed) return;
      setIsDirty(false);
      isDirtyRef.current = false;
      dismissServerBanner();
      await acknowledgeServerMtime("project");
    } catch (e) {
      console.error("[FlowEditor] save failed:", e);
      showError({
        title: "画面フローの保存に失敗しました",
        error: e,
      });
    } finally {
      setIsSaving(false);
    }
  }, [project, isSaving, isReadonly, saveCheckConflict, saveCommit, showError, dismissServerBanner, editSession]);

  const handleDiscard = useCallback(async () => {
    setShowDiscardDialog(false);
    await actions.discard();
    undoStackRef.current = [];
    redoStackRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    clearScreenFlowPositionsPreview();
    await reloadProject();
    dismissServerBanner();
    await acknowledgeServerMtime("project");
  }, [actions, reloadProject, dismissServerBanner]);

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
    await actions.discard();
    clearScreenFlowPositionsPreview();
    await reloadProject();
  }, [actions, reloadProject]);

  const handleReset = useCallback(async () => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    await reloadProject();
    dismissServerBanner();
    await acknowledgeServerMtime("project");
  }, [reloadProject, dismissServerBanner]);

  useSaveShortcut(() => {
    if (isDirty && !isSaving && !isReadonly) handleSave();
  });

  // Should-fix #1003: screenEntities が更新されたとき (marker 追加/解決/panel open 時) に
  // 各 ScreenNode の data.unresolvedCount を同期して badge 表示を最新に保つ
  useEffect(() => {
    if (screenEntities.size === 0) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type !== "screenNode") return n;
        const entity = screenEntities.get(n.id);
        if (!entity) return n;
        const unresolvedCount = (entity.authoring?.markers ?? []).filter((m) => !m.resolvedAt).length;
        if ((n.data as { unresolvedCount?: number }).unresolvedCount === unresolvedCount) return n;
        return { ...n, data: { ...n.data, unresolvedCount } };
      })
    );
  }, [screenEntities, setNodes]);

  const isEmpty = !isLoading && nodes.filter((n) => n.type === "screenNode").length === 0;
  const screenCount = nodes.filter((n) => n.type === "screenNode").length;
  const flowScreenNodes = useMemo(
    () => (project?.screens ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes],
  );
  const lockedByOther = mode.kind === "locked-by-other" ? mode : null;

  return (
    <div className={`flow-root${isReadonly ? " readonly-mode" : ""}`}>
      {showDiscardDialog && (
        <DiscardConfirmDialog
          onConfirm={() => { void handleDiscard(); }}
          onCancel={() => setShowDiscardDialog(false)}
        />
      )}
      {showForceReleaseDialog && lockedByOther && (
        <ForceReleaseConfirmDialog
          ownerSessionId={lockedByOther.ownerSessionId}
          ownerLabel={lockedByOther.ownerLabel}
          onConfirm={() => { void handleForceRelease(); }}
          onCancel={() => setShowForceReleaseDialog(false)}
        />
      )}
      {mode.kind === "force-released-pending" && (
        <ForcedOutChoiceDialog
          previousDraftExists={mode.previousDraftExists}
          onChoice={(choice) => { void actions.handleForcedOut(choice); if (choice !== "continue") void reloadProject(); }}
        />
      )}
      {mode.kind === "after-force-unlock" && (
        <AfterForceUnlockChoiceDialog
          previousOwner={mode.previousOwner}
          onChoice={(choice) => { void actions.handleAfterForceUnlock(choice); if (choice === "discard") void reloadProject(); }}
        />
      )}
      {showResumeDialog && (
        <ResumeOrDiscardDialog
          onResume={() => { void handleResumeContinue(); }}
          onDiscard={() => { void handleResumeDiscard(); }}
          onCancel={() => setShowResumeDialog(false)}
        />
      )}
      <EditModeToolbar
        mode={mode}
        onStartEditing={() => { void actions.startEditing(); }}
        onSave={() => { void handleSave(); }}
        onDiscardClick={() => setShowDiscardDialog(true)}
        onForceReleaseClick={() => setShowForceReleaseDialog(true)}
        saving={isSaving}
        ownerLabel={lockedByOther?.ownerSessionId}
      />
      {/* #994: collab UX 整合 — Viewer attach / take-over / 新規 draft / 履歴 */}
      <div className="d-flex justify-content-end" style={{ padding: "4px 8px" }}>
        <EditSessionDropdown
          resourceType="flow"
          resourceId="singleton"
          currentMode={mode}
          currentSessionId={sessionId}
          onStartEditing={() => { void actions.startEditing(); }}
          onViewerAttached={syncSessionToUrl}
          onAttachAsView={attach}
          onTakeOver={takeOver}
        />
      </div>
      {serverChanged && (
        <ServerChangeBanner
          onReload={handleReset}
          onDismiss={dismissServerBanner}
        />
      )}
      <FlowSubToolbar
        projectName={projectName}
        screenCount={screenCount}
        zoomLevel={zoomLevel}
        onAddScreen={handleOpenAddScreen}
        onAddGroup={() => { handleAddGroup().catch(console.error); }}
        onRenameProject={(name) => { handleRenameProject(name).catch(console.error); }}
        onClearAll={() => { handleClearAll().catch(console.error); }}
        onExportJSON={handleExportJSON}
        onImportJSON={(json) => { handleImportJSON(json).catch(console.error); }}
        onCopyMermaid={handleCopyMermaid}
        onExportMarkdown={handleExportMarkdown}
        onZoomChange={handleZoomChange}
        onFitView={handleFitView}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        isDirty={isDirty}
        isSaving={isSaving}
        onSave={() => { handleSave().catch(console.error); }}
        onReset={() => { handleReset().catch(console.error); }}
        onToggleMarkerPanel={() => { handleToggleMarkerPanel().catch(console.error); }}
        markerPanelOpen={markerPanelOpen}
      />

      {/* マーカーパネル (flow-canvas の右側にオーバーレイ表示) */}
      {markerPanelOpen && (
        <div className="flow-marker-panel-overlay">
          <FlowMarkerPanel
            screens={flowScreenNodes}
            screenEntities={screenEntities}
            onMarkerChange={(screenId, markers) =>
              handleMarkerChange(screenId, markers)
            }
            onClose={() => setMarkerPanelOpen(false)}
          />
        </div>
      )}

      <div className="flow-canvas">
        {isLoading ? (
          <div className="flow-loading">
            <div className="spinner" />
            <p>プロジェクトを読み込み中...</p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={isReadonly ? undefined : onEdgesChange}
            onConnect={isReadonly ? undefined : onConnect}
            onNodeDragStop={onNodeDragStop}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeContextMenu={isReadonly ? undefined : onNodeContextMenu}
            onEdgeDoubleClick={isReadonly ? undefined : onEdgeDoubleClick}
            onEdgeContextMenu={isReadonly ? undefined : onEdgeContextMenu}
            onReconnect={isReadonly ? undefined : onReconnect}
            onEdgesDelete={isReadonly ? undefined : onEdgesDelete}
            onNodesDelete={isReadonly ? undefined : onNodesDelete}
            onViewportChange={(vp) => setZoomLevel(vp.zoom)}
            nodeTypes={nodeTypes}
            connectionMode={ConnectionMode.Loose}
            nodesDraggable
            nodesConnectable={!isReadonly}
            edgesReconnectable={!isReadonly}
            deleteKeyCode={isReadonly ? null : ["Backspace", "Delete"]}
            defaultEdgeOptions={{
              markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
              style: { strokeWidth: 2, stroke: "#94a3b8" },
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cbd5e1" />
            <MiniMap
              nodeColor="#6366f1"
              maskColor="rgba(241,245,249,0.7)"
              style={{ borderRadius: 8 }}
            />
          </ReactFlow>
        )}

        {isEmpty && (
          <div className="flow-empty-state">
            <i className="bi bi-diagram-3" />
            <p>画面がまだありません</p>
            <button className="flow-btn flow-btn-primary" onClick={handleOpenAddScreen}>
              <i className="bi bi-plus-lg" /> 最初の画面を追加
            </button>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="flow-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.type === "group" ? (
            <>
              <button className="flow-context-menu-item" onClick={() => { handleRenameGroup().catch(console.error); }}>
                <i className="bi bi-pencil" /> グループ名を変更
              </button>
              <div className="flow-context-menu-separator" />
              <button className="flow-context-menu-item danger" onClick={() => { handleDeleteGroup().catch(console.error); }}>
                <i className="bi bi-trash" /> グループを削除
              </button>
            </>
          ) : contextMenu.type === "node" ? (
            <>
              <button className="flow-context-menu-item" onClick={handleDesignNode}>
                <i className="bi bi-pencil-square" /> デザインを開く
              </button>
              <button className="flow-context-menu-item" onClick={handleEditNode}>
                <i className="bi bi-gear" /> プロパティ編集
              </button>
              <button className="flow-context-menu-item" onClick={() => { handleDuplicateNode().catch(console.error); }}>
                <i className="bi bi-copy" /> 複製
              </button>
              <button className="flow-context-menu-item" onClick={handleRenameNode} data-testid="flow-node-rename-id-btn">
                <i className="bi bi-pencil-square" /> ID 変更…
              </button>
              {(() => {
                const screen = project?.screens.find((s) => s.id === contextMenu.targetId);
                const groups = project?.groups ?? [];
                if (!screen) return null;
                if (screen.groupId) {
                  return (
                    <>
                      <div className="flow-context-menu-separator" />
                      <button className="flow-context-menu-item" onClick={() => { handleUnassignGroup().catch(console.error); }}>
                        <i className="bi bi-collection" /> グループから外す
                      </button>
                    </>
                  );
                }
                if (groups.length > 0) {
                  return (
                    <>
                      <div className="flow-context-menu-separator" />
                      {groups.map((g) => (
                        <button key={g.id} className="flow-context-menu-item" onClick={() => { handleAssignGroup(g.id).catch(console.error); }}>
                          <i className="bi bi-collection" /> 「{g.name}」に追加
                        </button>
                      ))}
                    </>
                  );
                }
                return null;
              })()}
              <div className="flow-context-menu-separator" />
              <button className="flow-context-menu-item danger" onClick={() => { handleDeleteNode().catch(console.error); }}>
                <i className="bi bi-trash" /> 削除
              </button>
            </>
          ) : (
            <>
              <button className="flow-context-menu-item" onClick={handleEditEdge}>
                <i className="bi bi-pencil" /> 遷移を編集
              </button>
              <div className="flow-context-menu-separator" />
              <button className="flow-context-menu-item danger" onClick={() => { handleDeleteEdge().catch(console.error); }}>
                <i className="bi bi-trash" /> 遷移を削除
              </button>
            </>
          )}
        </div>
      )}

      {/* Screen Modal */}
      <ScreenEditModal
        open={screenModal.open}
        initial={screenModal.initial}
        title={screenModal.editId ? "画面の編集" : "画面の追加"}
        isCreate={!screenModal.editId}
        defaultEditorKind={projectDefaultEditorKind}
        defaultCssFramework={projectDefaultCssFramework}
        pageLayouts={screenModal.editId ? pageLayouts : undefined}
        existingScreenIds={project?.screens.map((s) => s.id) ?? []}
        onSave={(data) => { handleScreenSave(data).catch(console.error); }}
        onClose={() => setScreenModal({ open: false })}
      />

      {/* Edge Modal */}
      <EdgeEditModal
        open={edgeModal.open}
        initial={edgeModal.initial}
        onSave={(data) => { handleEdgeSave(data).catch(console.error); }}
        onDelete={edgeModal.editId ? () => { handleEdgeDeleteFromModal().catch(console.error); } : undefined}
        onClose={() => setEdgeModal({ open: false })}
      />

      {saveConflict && (
        <SaveConflictDialog
          conflict={saveConflict}
          onOverwrite={async () => {
            // P2 fix (#912): flow は backend editSession.save で write skip されるため、
            // 上書き確認後に frontend で persistProject() を先に実行し、saveCommit() で saveHistory を記録する。
            // (persist 失敗時に saveHistory が先行記録される問題を解消)
            // Should-fix (#916 review): project が null なら persist 不能 — dialog を閉じて状態リセット。
            if (!project) {
              onSaveConflictCancel();
              return;
            }
            try {
              await persistProject(project);
              const commitResult = await saveCommit();
              if (commitResult.failed) return;
              setIsDirty(false);
              isDirtyRef.current = false;
              dismissServerBanner();
              await acknowledgeServerMtime("project");
            } catch (e) {
              console.error("[FlowEditor] save overwrite failed:", e);
            }
          }}
          onCancel={onSaveConflictCancel}
        />
      )}

      {/* #1330: ScreenFlow 起点の Screen rename refactor dialog */}
      {renameTarget && (
        <RenameEntityDialog
          entityType="screen"
          currentId={renameTarget.id}
          currentName={renameTarget.name}
          existingIds={project?.screens.map((s) => s.id) ?? []}
          fetchExistingIds={async () => {
            const project = await loadProject();
            return (project.screens ?? []).map((s) => s.id);
          }}
          onClose={() => setRenameTarget(null)}
          onSuccess={(newId, operationId, extra) => {
            const target = renameTarget;
            // Codex Round 1 Should-fix: toast key 用に newId を先に固定
            setRenamedToastNewId(newId);
            setRenameTarget(null);
            handleRenameSuccess({
              entityType: "screen",
              oldId: target.id,
              newId,
              label: target.name || newId,
              navigate,
              wsPath,
              wsId,
              // #1330: Flow 起点 → 新 design tab を開かず ScreenFlow 画面に留まる
              skipOpenNewTab: true,
              originRoute: () => "/screen/flow",
            });
            // node graph を新 id で reload
            loadProject().then((p) => {
              setProject(p);
              setNodes((nds) => nds.map((n) => n.id === target.id
                ? { ...n, id: newId, data: { ...n.data, id: newId } as RFNode["data"] }
                : n));
              setEdges((eds) => eds.map((e) => ({
                ...e,
                source: e.source === target.id ? newId : e.source,
                target: e.target === target.id ? newId : e.target,
              })));
            }).catch(console.error);
            setRenameUndoToast({
              operationId, oldId: target.id, newId,
              ttlMs: extra?.ttlMs,
            });
          }}
        />
      )}

      {renameUndoToast && (
        <RenameEntityUndoToast
          operationId={renameUndoToast.operationId}
          oldId={renameUndoToast.oldId}
          newId={renameUndoToast.newId}
          ttlMs={renameUndoToast.ttlMs}
          entityLabel="画面"
          onUndo={() => {
            const oldId = renameUndoToast.newId;
            const newId = renameUndoToast.oldId;
            // undo: newId(=元 oldId) を toast key に切替
            setRenamedToastNewId(newId);
            handleRenameSuccess({
              entityType: "screen",
              oldId,
              newId,
              label: newId,
              navigate,
              wsPath,
              wsId,
              skipOpenNewTab: true,
              originRoute: () => "/screen/flow",
            });
            loadProject().then((p) => {
              setProject(p);
              setNodes((nds) => nds.map((n) => n.id === oldId
                ? { ...n, id: newId, data: { ...n.data, id: newId } as RFNode["data"] }
                : n));
              setEdges((eds) => eds.map((e) => ({
                ...e,
                source: e.source === oldId ? newId : e.source,
                target: e.target === oldId ? newId : e.target,
              })));
            }).catch(console.error);
            setRenameUndoToast(null);
            setRenamedToastNewId("");
          }}
          onDismiss={() => { setRenameUndoToast(null); setRenamedToastNewId(""); }}
        />
      )}
    </div>
  );
}

export function FlowEditor() {
  return (
    <ReactFlowProvider>
      <FlowEditorInner />
    </ReactFlowProvider>
  );
}
