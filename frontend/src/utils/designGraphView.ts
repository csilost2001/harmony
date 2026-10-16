/**
 * 設計全体のつながり図 (UI 改善提案 続編 第 7 弾 #132)。shared の buildDesignGraph (画面・処理フロー・テーブル・業務フロー・帳票・独自部品・メッセージなど) を、
 * React Flow のノードと線にする (画面に依存しない純関数)。位置は階層配置 (layeredLayout)。辺は「頼っている側 → 頼られている側」。
 */
import type { Edge, Node } from "@xyflow/react";
import { MarkerType } from "@xyflow/react";
import { NODE_KIND_LABELS, type DesignGraph, type NodeKind } from "@harmony/shared";
import { layeredLayout } from "./diagramGeom";

export const GRAPH_NODE_W = 190;
export const GRAPH_NODE_H = 46;

/** 既定では隠す種類 (数が多く、図が読みにくくなる共通の定義) */
export const DEFAULT_HIDDEN_KINDS: NodeKind[] = ["message", "regex", "limit", "genericDefinition", "component"];

export interface GraphElements { nodes: Node[]; edges: Edge[]; kindCounts: Array<{ kind: NodeKind; label: string; count: number }>; edgeKinds: Array<{ id: string; label: string }> }

export function buildGraphElements(graph: DesignGraph, hiddenNodeKinds: readonly NodeKind[] = DEFAULT_HIDDEN_KINDS): GraphElements {
  const hidden = new Set(hiddenNodeKinds);
  const all = [...graph.nodes.values()];
  const visible = all.filter((n) => !hidden.has(n.kind));
  const visibleKeys = new Set(visible.map((n) => n.key));
  const linked = graph.edges.filter((e) => visibleKeys.has(e.from) && visibleKeys.has(e.to));
  const pos = layeredLayout(visible.map((n) => ({ id: n.key, x: 0, y: 0, w: GRAPH_NODE_W, h: GRAPH_NODE_H })), linked.map((e) => ({ source: e.from, target: e.to })), { dx: 90, dy: 24 });

  const nodes: Node[] = all.map((n) => ({
    id: n.key,
    type: "default",
    position: pos.get(n.key) ?? { x: 0, y: 0 },
    data: { label: n.name || n.id, kind: n.kind, nodeId: n.id },
    className: `an-gnode an-gnode-${n.kind}`,
    style: { width: GRAPH_NODE_W, height: GRAPH_NODE_H },
    hidden: hidden.has(n.kind),
    sourcePosition: "right" as never,
    targetPosition: "left" as never,
  }));

  const kindOf = (key: string): NodeKind | undefined => graph.nodes.get(key)?.kind;
  const seen = new Set<string>();
  const edgeKindMap = new Map<string, string>();
  const edges: Edge[] = [];
  for (const e of graph.edges) {
    const fk = kindOf(e.from), tk = kindOf(e.to);
    if (!fk || !tk) continue;
    const id = `${e.from}>${e.to}`;
    if (seen.has(id)) continue; // 同じ組は 1 本にまとめる
    seen.add(id);
    const ek = `${fk}>${tk}`;
    edgeKindMap.set(ek, `${NODE_KIND_LABELS[fk]} → ${NODE_KIND_LABELS[tk]}`);
    edges.push({
      id, source: e.from, target: e.to, data: { kind: ek, label: e.label }, hidden: hidden.has(fk) || hidden.has(tk),
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 }, style: { strokeWidth: 1.5 },
    });
  }

  const counts = new Map<NodeKind, number>();
  for (const n of all) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
  const kindCounts = (Object.keys(NODE_KIND_LABELS) as NodeKind[]).filter((k) => counts.has(k)).map((k) => ({ kind: k, label: NODE_KIND_LABELS[k], count: counts.get(k)! }));
  return { nodes, edges, kindCounts, edgeKinds: [...edgeKindMap].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "ja")) };
}
