import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Edge as RFEdge,
  type Node as RFNode,
  type NodeMouseHandler,
  type Connection,
  ConnectionMode,
  MarkerType,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import ErTableNodeComponent, { type ErTableNodeData } from "./ErTableNode";
import { TableSubToolbar } from "./TableSubToolbar";
import type { Table, ErLayout, LogicalRelation, PhysicalName, DisplayName, LocalId, TableId } from "../../types/v3";
import { CARDINALITY_LABELS, type ErCardinality } from "../../utils/erUtils";
import { listTables, loadTable, createTable } from "../../store/tableStore";
import { loadErLayout, saveErLayout } from "../../store/erLayoutStore";
import { loadProject } from "../../store/flowStore";
import { getAllRelations, autoLayout, generateErMermaid } from "../../utils/erUtils";
import { generateSpecJson } from "../../utils/specExporter";
import { mcpBridge } from "../../mcp/mcpBridge";
import { generateUUID } from "../../utils/uuid";
import { useUndoKeyboard } from "../../hooks/useUndoKeyboard";
import html2canvas from "html2canvas";
import "../../styles/er.css";

const nodeTypes = { erTableNode: ErTableNodeComponent };

function ErDiagramInner() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const { fitView } = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([]);
  const [projectName, setProjectName] = useState("プロジェクト");
  const [tables, setTables] = useState<Table[]>([]);
  const [layout, setLayout] = useState<ErLayout | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddRelation, setShowAddRelation] = useState(false);
  const [pendingConnection, setPendingConnection] = useState<{ sourceTableId: string; targetTableId: string } | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [showAddTable, setShowAddTable] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutRef = useRef<ErLayout | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Undo/Redo スタック（レイアウト変更のみ対象）
  const undoStackRef = useRef<ErLayout[]>([]);
  const redoStackRef = useRef<ErLayout[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushLayoutUndo = useCallback(() => {
    if (!layoutRef.current) return;
    undoStackRef.current = [...undoStackRef.current, JSON.parse(JSON.stringify(layoutRef.current))].slice(-50);
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    if (layoutRef.current) {
      redoStackRef.current = [...redoStackRef.current, JSON.parse(JSON.stringify(layoutRef.current))];
    }
    const prev = undoStackRef.current[undoStackRef.current.length - 1];
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    layoutRef.current = prev;
    setLayout({ ...prev });
    saveErLayout(prev);
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
  }, []);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    if (layoutRef.current) {
      undoStackRef.current = [...undoStackRef.current, JSON.parse(JSON.stringify(layoutRef.current))];
    }
    const next = redoStackRef.current[redoStackRef.current.length - 1];
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    layoutRef.current = next;
    setLayout({ ...next });
    saveErLayout(next);
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);
  }, []);

  useUndoKeyboard(handleUndo, handleRedo);

  // Load data
  useEffect(() => {
    mcpBridge.startWithoutEditor();
    (async () => {
      const p = await loadProject();
      setProjectName(p.name);
      const metas = await listTables();
      const allTables: Table[] = [];
      for (const m of metas) {
        const td = await loadTable(m.id);
        if (td) allTables.push(td);
      }
      setTables(allTables);
      const ly = await loadErLayout();
      setLayout(ly);
      layoutRef.current = ly;
      setIsLoading(false);
    })();
  }, []);

  // Build nodes and edges when data changes
  useEffect(() => {
    if (isLoading || tables.length === 0) return;

    const positions = layout?.positions ?? {};
    const needsAutoLayout = tables.some((t) => !positions[t.id]);

    let finalPositions = positions;
    if (needsAutoLayout) {
      const relations = getAllRelations(tables, layout);
      const autoPos = autoLayout(tables, relations);
      finalPositions = { ...autoPos, ...positions };
    }

    const rfNodes: RFNode[] = tables.map((t) => ({
      id: t.id,
      type: "erTableNode",
      position: finalPositions[t.id] ?? { x: 0, y: 0 },
      data: {
        tableId: t.id,
        physicalName: t.physicalName,
        name: t.name,
        category: t.category,
        columns: t.columns,
      } satisfies ErTableNodeData,
    }));
    setNodes(rfNodes);

    const relations = getAllRelations(tables, layout);
    const rfEdges: RFEdge[] = relations.map((rel) => ({
      id: rel.id,
      source: rel.sourceTableId,
      target: rel.targetTableId,
      sourceHandle: "right",
      targetHandle: "left",
      label: rel.sourceColumnName || rel.label || "",
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style: {
        strokeWidth: 2,
        stroke: rel.physical ? "#64748b" : "#7c6bff",
        strokeDasharray: rel.physical ? undefined : "6 4",
      },
      labelStyle: { fontSize: 11, fill: rel.physical ? "#475569" : "#7c6bff" },
      labelBgStyle: { fill: "#fff", fillOpacity: 0.9 },
      labelBgPadding: [6, 4] as [number, number],
      labelBgBorderRadius: 4,
      data: { physical: rel.physical, cardinality: rel.cardinality },
    }));
    setEdges(rfEdges);

    // Fit view on first load
    setTimeout(() => fitView({ padding: 0.3, maxZoom: 1, duration: 200 }), 100);
  }, [isLoading, tables, layout, setNodes, setEdges, fitView]);

  // Save positions on node drag
  const debouncedSave = useCallback((ly: ErLayout) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveErLayout(ly), 300);
  }, []);

  const dragStartedRef = useRef(false);
  const onNodeDragStart = useCallback(() => {
    if (!dragStartedRef.current) {
      pushLayoutUndo();
      dragStartedRef.current = true;
    }
  }, [pushLayoutUndo]);

  const onNodeDragStop = useCallback((_: unknown, node: RFNode) => {
    dragStartedRef.current = false;
    const ly = layoutRef.current ?? { positions: {} as Record<string, { x: number; y: number }>, logicalRelations: [] as LogicalRelation[], updatedAt: new Date().toISOString() as never };
    ly.positions[node.id] = { x: Math.round(node.position.x), y: Math.round(node.position.y) };
    layoutRef.current = ly;
    setLayout({ ...ly });
    debouncedSave(ly);
  }, [debouncedSave]);

  // Double click to navigate to table editor
  const onNodeDoubleClick: NodeMouseHandler = useCallback((_event, node) => {
    navigate(`/table/edit/${node.id}`);
  }, [navigate]);

  // Handle drag-to-connect: open logical relation modal pre-filled
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;
    if (connection.source === connection.target) return;
    setPendingConnection({
      sourceTableId: connection.source,
      targetTableId: connection.target,
    });
    setShowAddRelation(true);
  }, []);

  // Auto layout
  const handleAutoLayout = useCallback(() => {
    pushLayoutUndo();
    const relations = getAllRelations(tables, layout);
    const autoPos = autoLayout(tables, relations);
    const ly = layoutRef.current ?? { positions: {} as Record<string, { x: number; y: number }>, logicalRelations: [] as LogicalRelation[], updatedAt: new Date().toISOString() as never };
    ly.positions = autoPos;
    layoutRef.current = ly;
    setLayout({ ...ly });
    debouncedSave(ly);

    setNodes((nds) => nds.map((n) => ({
      ...n,
      position: autoPos[n.id] ?? n.position,
    })));
    setTimeout(() => fitView({ padding: 0.3, maxZoom: 1, duration: 300 }), 50);
  }, [tables, layout, setNodes, fitView, debouncedSave]);

  // Add logical relation
  const handleAddLogicalRelation = useCallback((rel: Omit<LogicalRelation, "id">) => {
    pushLayoutUndo();
    const ly = layoutRef.current ?? { positions: {}, logicalRelations: [], updatedAt: new Date().toISOString() as never };
    if (!ly.logicalRelations) ly.logicalRelations = [];
    // LocalId pattern: 開始は英数字、内部は - / _ 可。"lr-<short>" 形式で採番。
    const short = generateUUID().split("-")[0];
    ly.logicalRelations.push({ ...rel, id: `lr-${short}` as LocalId });
    layoutRef.current = ly;
    setLayout({ ...ly });
    debouncedSave(ly);
    setShowAddRelation(false);
  }, [debouncedSave]);

  // Remove logical relation
  const handleRemoveEdge = useCallback((edgeId: string) => {
    pushLayoutUndo();
    const ly = layoutRef.current;
    if (!ly?.logicalRelations) return;
    ly.logicalRelations = ly.logicalRelations.filter((r) => r.id !== edgeId);
    layoutRef.current = ly;
    setLayout({ ...ly });
    debouncedSave(ly);
  }, [debouncedSave]);

  // Add table from ER diagram
  const handleAddTable = useCallback(async (physicalName: string, displayName: string, category?: string) => {
    const table = await createTable(physicalName as PhysicalName, displayName as DisplayName, "", category);
    const newTable = await loadTable(table.id);
    if (newTable) {
      setTables((prev) => [...prev, newTable]);
    }
    setShowAddTable(false);
  }, []);

  // Export Mermaid
  const handleExportMermaid = useCallback(() => {
    const relations = getAllRelations(tables, layout);
    const mermaid = generateErMermaid(tables, relations);
    navigator.clipboard.writeText(mermaid);
    setShowExport(false);
  }, [tables, layout]);

  // Export Spec JSON (AI向け統合仕様書)
  const handleExportSpecJson = useCallback(async () => {
    setShowExport(false);
    const project = await loadProject();
    const spec = generateSpecJson(project, tables, layout);
    const json = JSON.stringify(spec, null, 2);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName}_spec.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [projectName, tables, layout]);

  // Export PNG
  const handleExportPng = useCallback(async () => {
    setShowExport(false);
    const el = canvasRef.current?.querySelector(".react-flow__viewport") as HTMLElement | null;
    if (!el) return;
    const canvas = await html2canvas(el, { backgroundColor: "#1a1a2e", scale: 2, logging: false, useCORS: true });
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName}_er.png`;
    a.click();
  }, [projectName]);

  if (isLoading) {
    return (
      <div className="er-diagram-page">
        <TableSubToolbar />
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#888" }}>
          <i className="bi bi-hourglass-split" /> 読み込み中...
        </div>
      </div>
    );
  }

  return (
    <div className="er-diagram-page">
      <TableSubToolbar />

      <div className="er-diagram-canvas" ref={canvasRef}>
        {tables.length === 0 ? (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "#777", height: "100%" }}>
            <i className="bi bi-diagram-3" style={{ fontSize: 48, color: "#555" }} />
            <p>テーブル定義がまだありません</p>
            <button className="tbl-btn tbl-btn-primary" onClick={() => navigate(wsPath("/table/list"))}>
              <i className="bi bi-table" /> テーブル設計へ
            </button>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeDragStart={onNodeDragStart}
            onNodeDragStop={onNodeDragStop}
            onNodeDoubleClick={onNodeDoubleClick}
            onConnect={onConnect}
            connectionMode={ConnectionMode.Loose}
            onEdgeDoubleClick={(_e, edge) => {
              if (!(edge.data as { physical?: boolean })?.physical) {
                if (confirm("この論理リレーションを削除しますか？")) {
                  handleRemoveEdge(edge.id);
                }
              }
            }}
            deleteKeyCode={[]}
            fitView
            fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
            defaultEdgeOptions={{
              markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
              style: { strokeWidth: 2, stroke: "#64748b" },
            }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#334155" />
            <MiniMap
              nodeColor="#7c6bff"
              maskColor="rgba(26,26,46,0.7)"
              style={{ borderRadius: 8 }}
            />
          </ReactFlow>
        )}
      </div>

      {/* Toolbar */}
      <div className="er-toolbar">
        <div className="er-toolbar-group">
          <button className="tbl-btn tbl-btn-ghost tbl-btn-sm" onClick={handleUndo} disabled={!canUndo} title="元に戻す (Ctrl+Z)">
            <i className="bi bi-arrow-counterclockwise" />
          </button>
          <button className="tbl-btn tbl-btn-ghost tbl-btn-sm" onClick={handleRedo} disabled={!canRedo} title="やり直し (Ctrl+Y)">
            <i className="bi bi-arrow-clockwise" />
          </button>
          <button className="tbl-btn tbl-btn-ghost tbl-btn-sm" onClick={handleAutoLayout} title="自動配置">
            <i className="bi bi-grid-3x3-gap" /> 自動配置
          </button>
          <button className="tbl-btn tbl-btn-ghost tbl-btn-sm" onClick={() => fitView({ padding: 0.3, maxZoom: 1, duration: 300 })} title="全体表示">
            <i className="bi bi-arrows-fullscreen" /> 全体表示
          </button>
        </div>
        <div className="er-toolbar-sep" />
        <button
          className="tbl-btn tbl-btn-primary tbl-btn-sm"
          onClick={() => setShowAddTable(true)}
          title="テーブル追加"
        >
          <i className="bi bi-plus-lg" /> テーブル追加
        </button>
        <button
          className="tbl-btn tbl-btn-ghost tbl-btn-sm"
          onClick={() => setShowAddRelation(true)}
          title="リレーション追加"
        >
          <i className="bi bi-link-45deg" /> リレーション追加
        </button>
        <div className="er-toolbar-sep" />
        <div style={{ position: "relative" }}>
          <button className="tbl-btn tbl-btn-ghost tbl-btn-sm" onClick={() => setShowExport(!showExport)}>
            <i className="bi bi-download" /> エクスポート
          </button>
          {showExport && (
            <div className="er-export-menu">
              <button onClick={handleExportSpecJson}>
                <i className="bi bi-filetype-json" /> 統合仕様書 (JSON)
              </button>
              <button onClick={handleExportMermaid}>
                <i className="bi bi-clipboard" /> Mermaid をコピー
              </button>
              <button onClick={handleExportPng}>
                <i className="bi bi-image" /> PNG ダウンロード
              </button>
            </div>
          )}
        </div>
        <span className="er-toolbar-info">
          {tables.length} テーブル / {edges.length} リレーション
          <span style={{ marginLeft: 8, fontSize: 11, color: "#666" }}>ダブルクリックでテーブル編集</span>
        </span>
      </div>

      {/* Add Table Modal */}
      {showAddTable && (
        <AddTableFromErModal
          onAdd={handleAddTable}
          onClose={() => setShowAddTable(false)}
        />
      )}

      {/* Add Logical Relation Modal */}
      {showAddRelation && (
        <AddRelationModal
          tables={tables}
          initialSourceTableId={pendingConnection?.sourceTableId}
          initialTargetTableId={pendingConnection?.targetTableId}
          onAdd={handleAddLogicalRelation}
          onClose={() => { setShowAddRelation(false); setPendingConnection(null); }}
        />
      )}
    </div>
  );
}

export function ErDiagram() {
  return (
    <ReactFlowProvider>
      <ErDiagramInner />
    </ReactFlowProvider>
  );
}

// ── 論理リレーション追加モーダル ──────────────────────────────────────────

function AddRelationModal({
  tables, initialSourceTableId, initialTargetTableId, onAdd, onClose,
}: {
  tables: Table[];
  initialSourceTableId?: string;
  initialTargetTableId?: string;
  onAdd: (rel: Omit<LogicalRelation, "id">) => void;
  onClose: () => void;
}) {
  const [srcTableId, setSrcTableId] = useState(initialSourceTableId ?? "");
  const [srcColId, setSrcColId] = useState("");
  const [tgtTableId, setTgtTableId] = useState(initialTargetTableId ?? "");
  const [tgtColId, setTgtColId] = useState(() => {
    if (initialTargetTableId) {
      const tgt = tables.find((t) => t.id === initialTargetTableId);
      const pk = tgt?.columns.find((c) => c.primaryKey);
      return pk?.id ?? "";
    }
    return "";
  });
  const [cardinality, setCardinality] = useState<ErCardinality>("one-to-many");
  const [label, setLabel] = useState("");

  const srcTable = tables.find((t) => t.id === srcTableId);
  const tgtTable = tables.find((t) => t.id === tgtTableId);
  const hasColumns = srcTable && srcTable.columns.length > 0 && tgtTable && tgtTable.columns.length > 0;

  const handleSubmit = () => {
    if (!srcTableId || !tgtTableId) return;
    onAdd({
      sourceTableId: srcTableId as TableId,
      sourceColumnId: (srcColId || undefined) as LocalId | undefined,
      targetTableId: tgtTableId as TableId,
      targetColumnId: (tgtColId || undefined) as LocalId | undefined,
      cardinality,
      label: label.trim() || undefined,
    });
  };

  return (
    <div className="tbl-modal-overlay" onClick={onClose}>
      <div className="er-relation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tbl-modal-title">
          <i className="bi bi-link-45deg" /> リレーション追加
        </div>
        <p style={{ fontSize: 12, color: "#999", marginBottom: 16 }}>
          テーブル間の関連をER図に追加します（点線で表示）。カラムは後から設定できます。
        </p>

        {/* メモ欄（目立つ位置に配置） */}
        <label className="tbl-field" style={{ marginBottom: 16 }}>
          <span><i className="bi bi-chat-left-text" /> メモ（リレーションの説明）</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例: 顧客は複数の注文を持つ"
            autoFocus
            style={{ fontSize: 14, padding: "8px 10px" }}
          />
        </label>

        <div className="er-relation-row">
          <div style={{ flex: 1 }}>
            <label className="tbl-field">
              <span>参照元テーブル（多側 / FK側）</span>
              <select value={srcTableId} onChange={(e) => { setSrcTableId(e.target.value); setSrcColId(""); }}>
                <option value="">選択...</option>
                {tables.map((t) => <option key={t.id} value={t.id}>{t.physicalName}（{t.name}）</option>)}
              </select>
            </label>
            {hasColumns && (
              <label className="tbl-field">
                <span>参照元カラム <small style={{ color: "#666" }}>（任意）</small></span>
                <select value={srcColId} onChange={(e) => setSrcColId(e.target.value)}>
                  <option value="">（未定）</option>
                  {srcTable?.columns.map((c) => <option key={c.id} value={c.id}>{c.physicalName}（{c.name}）</option>)}
                </select>
              </label>
            )}
          </div>
          <span className="er-relation-arrow">→</span>
          <div style={{ flex: 1 }}>
            <label className="tbl-field">
              <span>参照先テーブル（1側）</span>
              <select value={tgtTableId} onChange={(e) => { setTgtTableId(e.target.value); setTgtColId(""); }}>
                <option value="">選択...</option>
                {tables.map((t) => <option key={t.id} value={t.id}>{t.physicalName}（{t.name}）</option>)}
              </select>
            </label>
            {hasColumns && (
              <label className="tbl-field">
                <span>参照先カラム <small style={{ color: "#666" }}>（任意）</small></span>
                <select value={tgtColId} onChange={(e) => setTgtColId(e.target.value)}>
                  <option value="">（未定）</option>
                  {tgtTable?.columns.map((c) => {
                    const icons = c.primaryKey ? "🔑 " : c.unique ? "🔗 " : "";
                    return <option key={c.id} value={c.id}>{icons}{c.physicalName}（{c.name}）</option>;
                  })}
                </select>
              </label>
            )}
          </div>
        </div>

        <label className="tbl-field">
          <span>カーディナリティ</span>
          <select value={cardinality} onChange={(e) => setCardinality(e.target.value as ErCardinality)}>
            {Object.entries(CARDINALITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>

        <div className="tbl-modal-btns">
          <button className="tbl-btn tbl-btn-ghost" onClick={onClose}>キャンセル</button>
          <button
            className="tbl-btn tbl-btn-primary"
            onClick={handleSubmit}
            disabled={!srcTableId || !tgtTableId}
          >
            追加
          </button>
        </div>
      </div>
    </div>
  );
}

// ── ER図からテーブル追加モーダル ──────────────────────────────────────────

function AddTableFromErModal({
  onAdd, onClose,
}: {
  onAdd: (physicalName: string, displayName: string, category?: string) => void;
  onClose: () => void;
}) {
  const [physicalName, setPhysicalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [category, setCategory] = useState("");

  return (
    <div className="tbl-modal-overlay" onClick={onClose}>
      <div className="tbl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tbl-modal-title">
          <i className="bi bi-plus-lg" /> エンティティ（テーブル）追加
        </div>
        <label className="tbl-field">
          <span>物理名 <small>(snake_case)</small></span>
          <input
            type="text"
            value={physicalName}
            onChange={(e) => setPhysicalName(e.target.value)}
            placeholder="customers"
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter" && physicalName.trim() && displayName.trim()) onAdd(physicalName.trim(), displayName.trim(), category || undefined); }}
          />
        </label>
        <label className="tbl-field">
          <span>表示名</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="顧客マスタ"
            onKeyDown={(e) => { if (e.key === "Enter" && physicalName.trim() && displayName.trim()) onAdd(physicalName.trim(), displayName.trim(), category || undefined); }}
          />
        </label>
        <label className="tbl-field">
          <span>カテゴリ</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
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
          <button className="tbl-btn tbl-btn-ghost" onClick={onClose}>キャンセル</button>
          <button
            className="tbl-btn tbl-btn-primary"
            onClick={() => onAdd(physicalName.trim(), displayName.trim(), category || undefined)}
            disabled={!physicalName.trim() || !displayName.trim()}
          >
            追加
          </button>
        </div>
      </div>
    </div>
  );
}
