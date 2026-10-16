/**
 * つながり図 (UI 改善提案 続編 第 7 弾 #132): 設計全体の参照のつながりを、ノードと線で見る。
 * 画面・処理フロー・テーブル・業務フロー・帳票・独自部品・メッセージなどの、「何が何に頼っているか」(左 = 頼っている側 → 右 = 頼られている側)。
 * 種類で絞る・検索 (Ctrl+F)・選んだものとつながるものの強調・関連 N 段への絞り込み・線の種類の表示 / 非表示・PNG 書き出し・印刷が使える。
 * 設計は書き換えない (位置は、開くたびに自動で決める)。ノードのダブルクリックで、その設計を開く。
 */
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Background, BackgroundVariant, MiniMap, ReactFlow, ReactFlowProvider, useNodesState, type Node, type NodeMouseHandler } from "@xyflow/react";
import { buildDesignGraph, NODE_KIND_LABELS, type DesignDocInput, type NodeKind } from "@harmony/shared";
import "@xyflow/react/dist/style.css";
import { DiagramControls } from "../../common/DiagramControls";
import { DiagramTools, type LegendItem } from "../../common/DiagramTools";
import { useDiagramView } from "../../../hooks/useDiagramView";
import { useWorkspacePath } from "../../../hooks/useWorkspacePath";
import { buildGraphElements, DEFAULT_HIDDEN_KINDS } from "../../../utils/designGraphView";
import { ROUTES } from "../../../utils/relatedDesigns";
import type { DiagramConfig } from "../../../utils/diagramView";

const LEGEND: LegendItem[] = [
  { kind: "line", label: "矢印は「頼っている側 → 頼られている側」(右の設計を変えると、左の設計に影響します)" },
  { kind: "box", label: "ノード (ダブルクリックでその設計を開く。色は種類ごと)" },
];

function GraphInner({ input }: { input: DesignDocInput }) {
  const navigate = useNavigate();
  const { wsPath, wsId } = useWorkspacePath();
  const [hiddenKinds, setHiddenKinds] = useState<NodeKind[]>(DEFAULT_HIDDEN_KINDS);
  const graph = useMemo(() => buildDesignGraph(input), [input]);
  const els = useMemo(() => buildGraphElements(graph, hiddenKinds), [graph, hiddenKinds]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(els.nodes);
  // 種類の絞り込みや設計が変わったら、ノードを作り直す (選択は、id が同じなら引き継ぐ)
  const [seenEls, setSeenEls] = useState(els);
  if (seenEls !== els) {
    setSeenEls(els);
    const selected = new Set(nodes.filter((n) => n.selected).map((n) => n.id));
    setNodes(els.nodes.map((n) => (selected.has(n.id) ? { ...n, selected: true } : n)));
  }
  const canvasRef = useRef<HTMLDivElement>(null);
  const config = useMemo<DiagramConfig>(() => ({
    textsOf: (n) => [String((n.data as { label?: string }).label ?? ""), String((n.data as { nodeId?: string }).nodeId ?? ""), NODE_KIND_LABELS[(n.data as { kind: NodeKind }).kind] ?? ""],
    kindOfEdge: (e) => String((e.data as { kind?: string } | undefined)?.kind ?? ""),
    labelOf: (n) => `${NODE_KIND_LABELS[(n.data as { kind: NodeKind }).kind]} ${(n.data as { label?: string }).label ?? n.id}`,
  }), []);
  const dv = useDiagramView(`graph:${wsId ?? "default"}`, nodes, els.edges, config);
  const onOpen: NodeMouseHandler = (_e, node) => {
    const d = node.data as { kind: NodeKind; nodeId: string };
    const route = ROUTES[d.kind]?.(d.nodeId);
    if (route) navigate(wsPath(route));
  };
  const toggleKind = (k: NodeKind) => setHiddenKinds((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  return (
    <div className="an-graph" data-testid="an-graph">
      <div className="an-graph-kinds" role="group" aria-label="表示する種類">
        {els.kindCounts.map((k) => (
          <label key={k.kind} className={`an-gchip an-gnode-${k.kind}${hiddenKinds.includes(k.kind) ? " is-off" : ""}`}>
            <input type="checkbox" checked={!hiddenKinds.includes(k.kind)} onChange={() => toggleKind(k.kind)} data-testid={`an-graph-kind-${k.kind}`} /> {k.label} <span className="an-gchip-n">{k.count}</span>
          </label>
        ))}
        <span className="an-graph-note">{els.nodes.filter((n) => !n.hidden).length} 件 ・ 線 {els.edges.filter((e) => !e.hidden).length} 本</span>
      </div>
      <div className="an-graph-canvas" ref={canvasRef}>
        <ReactFlow nodes={dv.decorated.nodes} edges={dv.decorated.edges} onNodesChange={onNodesChange} onNodeDoubleClick={onOpen}
          nodesConnectable={false} nodesDraggable fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} minZoom={0.1} deleteKeyCode={null}>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
          <DiagramControls />
          <DiagramTools title="つながり図" fileStem="design-graph" api={dv} nodes={nodes} readOnly onNodesChange={(fn) => setNodes(fn)} canvasRef={canvasRef} edgeKinds={els.edgeKinds} legend={LEGEND} />
          <MiniMap nodeColor="var(--hm-accent)" maskColor="color-mix(in srgb, var(--hm-bg) 70%, transparent)" style={{ borderRadius: 8 }} />
        </ReactFlow>
      </div>
    </div>
  );
}

export function GraphTab({ input }: { input: DesignDocInput }) {
  return <ReactFlowProvider><GraphInner input={input} /></ReactFlowProvider>;
}
