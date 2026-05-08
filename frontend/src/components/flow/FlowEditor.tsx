import { useState, useCallback, useRef, useEffect } from "react";
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
import { ScreenEditModal, type ScreenFormData } from "./ScreenEditModal";
import { EdgeEditModal, type EdgeFormData, type HandlePosition } from "./EdgeEditModal";
import type { FlowProject, ScreenNode, ScreenEdge, ScreenGroup } from "../../types/flow";
import { TRIGGER_LABELS } from "../../types/flow";
import type { ScreenGroupId, ScreenKind, ScreenLayout, Timestamp } from "../../types/v3";
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
import { clearScreenLayoutPreview, saveScreenLayoutPreview } from "../../store/screenLayoutStore";
import { duplicateScreenDesignData } from "../../store/duplicateScreen";
import { resolveEditorKind } from "../../utils/resolveEditorKind";
import { resolveCssFramework } from "../../utils/resolveCssFramework";
import { useUndoKeyboard } from "../../hooks/useUndoKeyboard";
import { useSaveShortcut } from "../../hooks/useSaveShortcut";
import { useFlowProjectSync } from "../../hooks/useFlowProjectSync";
import { useEditSession } from "../../hooks/useEditSession";
import { useSessionUrlSync } from "../../hooks/useSessionUrlSync";
import { EditModeToolbar } from "../editing/EditModeToolbar";
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

function toRFNodesWithGroups(screens: ScreenNode[], groups: ScreenGroup[]): RFNode[] {
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
    const node: RFNode = {
      id: s.id,
      type: "screenNode",
      position: s.position,
      data: { ...s },
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

function toScreenLayoutPreview(project: FlowProject): Pick<ScreenLayout, "positions"> {
  const positions: ScreenLayout["positions"] = {};
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
  const { wsPath } = useWorkspacePath();
  const projectRef = useRef<FlowProject | null>(null);
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

  const sessionId = mcpBridge.getSessionId();

  // URL ?session= 同期 (spec §11.2) — initialEditSessionId を useEditSession に渡すため先に呼ぶ
  const { initialEditSessionId: initialFlowSessionId } = useSessionUrlSync({
    resourceType: "flow",
    resourceId: "singleton",
  });

  // P2-2 fix (#907): URL ?session= から復元した initialEditSessionId を渡す (URL 招待 attach 復活)
  const { editSession, mode, loading: sessionLoading, isDirtyForTab, actions, saveCheckConflict, saveCommit, saveConflict, onSaveConflictCancel } = useEditSession({
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
    if (!projectRef.current) return;
    undoStackRef.current = [...undoStackRef.current, JSON.parse(JSON.stringify(projectRef.current))].slice(-50);
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0 || !projectRef.current) return;
    redoStackRef.current = [...redoStackRef.current, JSON.parse(JSON.stringify(projectRef.current))];
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    projectRef.current = prev;
    setNodes(toRFNodesWithGroups(prev.screens, prev.groups ?? []));
    setEdges(toRFEdges(prev.edges));
    setProjectName(prev.name);
    saveProject(prev).catch(console.error);
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
  }, [setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0 || !projectRef.current) return;
    undoStackRef.current = [...undoStackRef.current, JSON.parse(JSON.stringify(projectRef.current))];
    const next = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    projectRef.current = next;
    setNodes(toRFNodesWithGroups(next.screens, next.groups ?? []));
    setEdges(toRFEdges(next.edges));
    setProjectName(next.name);
    saveProject(next).catch(console.error);
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  }, [setNodes, setEdges]);

  useUndoKeyboard(handleUndo, handleRedo, !isReadonly);

  // プロジェクトを読み込んで UI に反映
  const reloadProject = useCallback(async () => {
    const [project, raw] = await Promise.all([loadProject(), loadRawProject()]);
    projectRef.current = project;
    setNodes(toRFNodesWithGroups(project.screens, project.groups ?? []));
    setEdges(toRFEdges(project.edges));
    setProjectName(project.name);
    setProjectDefaultEditorKind(resolveEditorKind(undefined, raw.techStack));
    setProjectDefaultCssFramework(resolveCssFramework(undefined, raw.techStack));
    needsFitViewRef.current = project.screens.length > 0;
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

  const { serverChanged, dismissServerBanner } = useFlowProjectSync({
    reload: reloadProject,
    isDirtyRef,
    setIsDirty,
    navigate,
  });

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
      const res = await mcpBridge.request("editSession.list", { resourceType: "flow", resourceId: "singleton" }) as { sessions: unknown[] } | null;
      if (cancelled) return;
      if (res && res.sessions.length > 0) setShowResumeDialog(true);
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [sessionLoading, mode.kind]);

  // project.techStack.designer の project default (画面作成ダイアログのデフォルト選択値)
  const [projectDefaultEditorKind, setProjectDefaultEditorKind] = useState<"grapesjs" | "puck">("grapesjs");
  const [projectDefaultCssFramework, setProjectDefaultCssFramework] = useState<"bootstrap" | "tailwind">("bootstrap");

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

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  // ノード位置変更時の保存デバウンス
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncAndSave = useCallback(() => {
    if (!projectRef.current) return;
    saveScreenLayoutPreview(toScreenLayoutPreview(projectRef.current));
    if (saveDebounceRef.current) clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      if (projectRef.current) {
        if (!isReadonly) {
          saveProject(projectRef.current).catch(console.error);
          // ドラフト更新 (edit-session-draft)
          if (editSession?.id) {
            mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: projectRef.current }).catch(console.error);
          }
        }
      }
    }, 300);
  }, [isReadonly, editSession]);

  const onNodeDragStop = useCallback((_: unknown, node: RFNode) => {
    if (!projectRef.current) return;
    const screen = projectRef.current.screens.find((s) => s.id === node.id);
    if (screen) {
      screen.position = node.position;
      syncAndSave();
      return;
    }
    const group = (projectRef.current.groups ?? []).find((g) => g.id === node.id);
    if (group) {
      group.position = node.position;
      syncAndSave();
    }
  }, [syncAndSave]);

  const onConnect = useCallback((connection: Connection) => {
    if (isReadonly || !connection.source || !connection.target || !projectRef.current) return;
    pushUndoSnapshot();
    storeAddEdge(
      projectRef.current,
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
  }, [setEdges]);

  const onNodeDoubleClick: NodeMouseHandler = useCallback((_event, node) => {
    if (node.type === "screenNode") {
      const screenName = (node.data as { name?: string }).name ?? node.id;
      openTab({ id: makeTabId("design", node.id), type: "design", resourceId: node.id, label: screenName });
    }
    navigate(wsPath(`/screen/design/${node.id}`));
  }, [navigate]);

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
    if (!projectRef.current) return;
    const storeEdge = projectRef.current.edges.find((e) => e.id === edge.id);
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
  }, []);

  // ── Screen Modal Actions ──

  const handleOpenAddScreen = useCallback(() => {
    if (isReadonly) return;
    setScreenModal({ open: true });
  }, [isReadonly]);

  const handleScreenSave = useCallback(async (data: ScreenFormData) => {
    if (!projectRef.current) return;
    pushUndoSnapshot();
    if (screenModal.editId) {
      await updateScreen(projectRef.current, screenModal.editId, {
        name: data.name,
        kind: data.type as ScreenKind,
        path: data.path,
        description: data.description,
      });
      setNodes((nds) => nds.map((n) => {
        if (n.id !== screenModal.editId || !projectRef.current) return n;
        const screen = projectRef.current.screens.find((s) => s.id === n.id)!;
        return { ...n, data: { ...screen } };
      }));
    } else {
      const editorKind = data.editorKind ?? projectDefaultEditorKind;
      const cssFramework = data.cssFramework ?? projectDefaultCssFramework;
      const screen = await addScreen(projectRef.current, data.name, data.type as ScreenKind, { path: data.path, editorKind, cssFramework });
      screen.description = data.description;
      await saveProject(projectRef.current);
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
  }, [screenModal.editId, projectDefaultEditorKind, projectDefaultCssFramework, setNodes]);

  // ── Edge Modal Actions ──

  const handleEdgeSave = useCallback(async (data: EdgeFormData) => {
    if (!edgeModal.editId || !projectRef.current) return;
    pushUndoSnapshot();
    await storeUpdateEdge(projectRef.current, edgeModal.editId, {
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
  }, [edgeModal.editId, setEdges]);

  const handleEdgeDeleteFromModal = useCallback(async () => {
    if (!edgeModal.editId || !projectRef.current) return;
    await storeRemoveEdge(projectRef.current, edgeModal.editId);
    setEdges((eds) => eds.filter((e) => e.id !== edgeModal.editId));
    setEdgeModal({ open: false });
  }, [edgeModal.editId, setEdges]);

  // ── Context Menu Actions ──

  const handleEditNode = useCallback(() => {
    if (!contextMenu || !projectRef.current) return;
    const screen = projectRef.current.screens.find((s) => s.id === contextMenu.targetId);
    if (screen) {
      setScreenModal({
        open: true,
        editId: screen.id,
        initial: { name: screen.name, type: screen.kind, path: screen.path, description: screen.description },
      });
    }
    setContextMenu(null);
  }, [contextMenu]);

  const handleDuplicateNode = useCallback(async () => {
    if (!contextMenu || !projectRef.current) return;
    pushUndoSnapshot();
    const screen = projectRef.current.screens.find((s) => s.id === contextMenu.targetId);
    if (screen) {
      // コピー元の editorKind/cssFramework を継承する (spec § 2.5.2: 作成時固定)
      const srcEntity = await loadScreenEntity(screen.id);
      const srcEditorKind = resolveEditorKind(srcEntity.design, undefined);
      const srcCssFramework = resolveCssFramework(srcEntity.design, undefined);
      const dup = await addScreen(
        projectRef.current,
        `${screen.name} (コピー)`,
        screen.kind,
        {
          path: screen.path,
          position: { x: screen.position.x + 30, y: screen.position.y + 30 },
          editorKind: srcEditorKind,
          cssFramework: srcCssFramework,
        },
      );
      dup.description = screen.description;
      await saveProject(projectRef.current);
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
  }, [contextMenu, setNodes]);

  const handleDeleteNode = useCallback(async () => {
    if (!contextMenu || !projectRef.current) return;
    pushUndoSnapshot();
    const screen = projectRef.current.screens.find((s) => s.id === contextMenu.targetId);
    if (screen && confirm(`「${screen.name}」を削除しますか？\nデザインデータも削除されます。`)) {
      await removeScreen(projectRef.current, contextMenu.targetId);
      setNodes((nds) => nds.filter((n) => n.id !== contextMenu.targetId));
      setEdges((eds) => eds.filter(
        (e) => e.source !== contextMenu.targetId && e.target !== contextMenu.targetId
      ));
    }
    setContextMenu(null);
  }, [contextMenu, setNodes, setEdges]);

  const handleDesignNode = useCallback(() => {
    if (!contextMenu) return;
    const screenId = contextMenu.targetId;
    const screenName = nodes.find((n) => n.id === screenId)?.data
      ? ((nodes.find((n) => n.id === screenId)!.data as { name?: string }).name ?? screenId)
      : screenId;
    openTab({ id: makeTabId("design", screenId), type: "design", resourceId: screenId, label: screenName });
    navigate(wsPath(`/screen/design/${screenId}`));
    setContextMenu(null);
  }, [contextMenu, navigate, nodes]);

  // ── Group Actions ──

  const handleAddGroup = useCallback(async () => {
    if (!projectRef.current) return;
    const name = prompt("グループ名を入力してください", "グループ");
    if (!name) return;
    const group = await storeAddGroup(projectRef.current, name.trim(), { x: 80, y: 80 });
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
  }, [setNodes]);

  const handleRenameGroup = useCallback(async () => {
    if (!contextMenu || !projectRef.current) return;
    const group = (projectRef.current.groups ?? []).find((g) => g.id === contextMenu.targetId);
    if (!group) return;
    const name = prompt("新しいグループ名を入力してください", group.name);
    if (!name || name.trim() === group.name) { setContextMenu(null); return; }
    await storeUpdateGroup(projectRef.current, group.id, { name: name.trim() });
    setNodes((nds) => nds.map((n) =>
      n.id === group.id ? { ...n, data: { ...n.data, name: name.trim() } } : n
    ));
    setContextMenu(null);
  }, [contextMenu, setNodes]);

  const handleDeleteGroup = useCallback(async () => {
    if (!contextMenu || !projectRef.current) return;
    const group = (projectRef.current.groups ?? []).find((g) => g.id === contextMenu.targetId);
    if (!group) return;
    if (!confirm(`グループ「${group.name}」を削除しますか？\n（画面はグループから外れますが削除されません）`)) {
      setContextMenu(null);
      return;
    }
    await storeRemoveGroup(projectRef.current, contextMenu.targetId);
    setNodes(toRFNodesWithGroups(projectRef.current.screens, projectRef.current.groups ?? []));
    setContextMenu(null);
  }, [contextMenu, setNodes]);

  const handleAssignGroup = useCallback(async (groupId: ScreenGroupId) => {
    if (!contextMenu || !projectRef.current) return;
    const screen = projectRef.current.screens.find((s) => s.id === contextMenu.targetId);
    const group = (projectRef.current.groups ?? []).find((g) => g.id === groupId);
    if (!screen || !group) return;
    // Convert absolute position to relative within the group
    const absPos = screen.groupId
      ? (() => {
          const cur = (projectRef.current!.groups ?? []).find((g) => g.id === screen.groupId);
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
    await saveProject(projectRef.current);
    setNodes(toRFNodesWithGroups(projectRef.current.screens, projectRef.current.groups ?? []));
    setContextMenu(null);
  }, [contextMenu, setNodes]);

  const handleUnassignGroup = useCallback(async () => {
    if (!contextMenu || !projectRef.current) return;
    const screen = projectRef.current.screens.find((s) => s.id === contextMenu.targetId);
    if (!screen || !screen.groupId) return;
    const group = (projectRef.current.groups ?? []).find((g) => g.id === screen.groupId);
    if (group) {
      screen.position = {
        x: screen.position.x + group.position.x,
        y: screen.position.y + group.position.y,
      };
    }
    screen.groupId = undefined;
    screen.updatedAt = new Date().toISOString() as Timestamp;
    await saveProject(projectRef.current);
    setNodes(toRFNodesWithGroups(projectRef.current.screens, projectRef.current.groups ?? []));
    setContextMenu(null);
  }, [contextMenu, setNodes]);

  // ── Edge Context Menu Actions ──

  const handleEditEdge = useCallback(() => {
    if (!contextMenu || contextMenu.type !== "edge" || !projectRef.current) return;
    const storeEdge = projectRef.current.edges.find((e) => e.id === contextMenu.targetId);
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
  }, [contextMenu]);

  const handleDeleteEdge = useCallback(async () => {
    if (!contextMenu || contextMenu.type !== "edge" || !projectRef.current) return;
    pushUndoSnapshot();
    await storeRemoveEdge(projectRef.current, contextMenu.targetId);
    setEdges((eds) => eds.filter((e) => e.id !== contextMenu.targetId));
    setContextMenu(null);
  }, [contextMenu, setEdges]);

  // ドラッグによるエッジ端点の付け替え
  const onReconnect = useCallback((oldEdge: RFEdge, newConnection: Connection) => {
    setEdges((eds) => reconnectEdge(oldEdge, newConnection, eds));
    if (!projectRef.current) return;
    storeUpdateEdge(projectRef.current, oldEdge.id, {
      sourceHandle: (newConnection.sourceHandle ?? oldEdge.sourceHandle ?? "bottom") as HandlePosition,
      targetHandle: (newConnection.targetHandle ?? oldEdge.targetHandle ?? "top") as HandlePosition,
    }).catch(console.error);
  }, [setEdges]);

  const onEdgesDelete = useCallback((deletedEdges: RFEdge[]) => {
    if (!projectRef.current) return;
    Promise.all(deletedEdges.map((e) => storeRemoveEdge(projectRef.current!, e.id)))
      .catch(console.error);
  }, []);

  const onNodesDelete = useCallback((deletedNodes: RFNode[]) => {
    if (!projectRef.current) return;
    const project = projectRef.current;
    const promises = deletedNodes.map((n) => {
      if (project.screens.find((s) => s.id === n.id)) {
        return removeScreen(project, n.id);
      }
      if ((project.groups ?? []).find((g) => g.id === n.id)) {
        return storeRemoveGroup(project, n.id).then(() => {
          // Rebuild nodes to reflect ungrouped screens
          if (projectRef.current) {
            setNodes(toRFNodesWithGroups(projectRef.current.screens, projectRef.current.groups ?? []));
          }
          return true;
        });
      }
      return Promise.resolve(false);
    });
    Promise.all(promises).catch(console.error);
  }, [setNodes]);

  // ── Project-level Actions ──

  const handleRenameProject = useCallback(async (name: string) => {
    if (!projectRef.current) return;
    projectRef.current.name = name;
    await saveProject(projectRef.current);
    setProjectName(name);
  }, []);

  const handleClearAll = useCallback(async () => {
    if (!projectRef.current) return;
    if (!confirm("すべての画面と遷移を削除しますか？\n各画面のデザインデータも削除されます。")) return;
    // スナップショットを取ってから削除（removeScreen が配列を変更するため）
    for (const s of [...projectRef.current.screens]) {
      await removeScreen(projectRef.current, s.id).catch(console.error);
    }
    setNodes([]);
    setEdges([]);
  }, [setNodes, setEdges]);

  // ── ファイル操作 ──

  const handleExportJSON = useCallback(() => {
    if (!projectRef.current) return;
    const json = exportProjectJSON(projectRef.current);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectRef.current.name || "flow-project"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImportJSON = useCallback(async (json: string) => {
    try {
      const imported = await importProjectJSON(json);
      projectRef.current = imported;
      setNodes(toRFNodesWithGroups(imported.screens, imported.groups ?? []));
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
    if (!projectRef.current) return;
    const mermaid = generateMermaid(projectRef.current);
    navigator.clipboard.writeText(mermaid).then(
      () => alert("Mermaid 記法をクリップボードにコピーしました"),
      (e) => showError({
        title: "クリップボードへのコピーに失敗しました",
        error: e,
        message: e instanceof Error ? e.message : "ブラウザがクリップボードへのアクセスを拒否した可能性があります。",
      }),
    );
  }, [showError]);

  const handleExportMarkdown = useCallback(() => {
    if (!projectRef.current) return;
    const md = generateFlowMarkdown(projectRef.current);
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectRef.current.name || "flow-project"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleSave = useCallback(async () => {
    if (!projectRef.current || isSaving || isReadonly) return;
    // pending debounce があればキャンセルして即 flush
    // 編集開始直後に保存した場合 draft が空のまま commitDraft に到達してゾンビロックになるのを防ぐ
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = null;
    }
    if (editSession?.id) {
      await mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: projectRef.current });
    }
    setIsSaving(true);
    try {
      // P2 fix (#912): 2 段階保存。flow は backend editSession.save で本体書き込みを skip し、
      // 代わりに frontend persistProject() が harmony.json + screen-layout.json を書く設計のため、
      // saveHistory 記録が persist 失敗時に先行記録される問題を解消するため checkOnly → persist → commit の順で実行する。
      const checkResult = await saveCheckConflict();
      if (checkResult.conflicted || checkResult.failed) return;
      await persistProject(projectRef.current);
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
  }, [isSaving, isReadonly, saveCheckConflict, saveCommit, showError, dismissServerBanner, editSession]);

  const handleDiscard = useCallback(async () => {
    setShowDiscardDialog(false);
    await actions.discard();
    undoStackRef.current = [];
    redoStackRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
    clearScreenLayoutPreview();
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
    clearScreenLayoutPreview();
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

  const isEmpty = !isLoading && nodes.filter((n) => n.type === "screenNode").length === 0;
  const screenCount = nodes.filter((n) => n.type === "screenNode").length;
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
      />

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
              {(() => {
                const screen = projectRef.current?.screens.find((s) => s.id === contextMenu.targetId);
                const groups = projectRef.current?.groups ?? [];
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
            // Should-fix (#916 review): projectRef.current が null なら persist 不能 — dialog を閉じて状態リセット。
            if (!projectRef.current) {
              onSaveConflictCancel();
              return;
            }
            try {
              await persistProject(projectRef.current);
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
