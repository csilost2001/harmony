/**
 * 図の「見え方」(UI 改善提案 続編 第 7 弾): 検索・つながりの強調・関連 N 段への絞り込み・線の種類の表示 / 非表示・線の形・
 * グループの折りたたみ・ERのカラム表示・基準との差分。React Flow のノード・線を、見え方に合わせて飾る純関数 (原本・保存する座標は変えない)。
 */
import type { Edge, Node } from "@xyflow/react";
import { neighborhood, searchNodeIds } from "./diagramGeom";

export type EdgeShape = "default" | "smoothstep" | "straight" | "step";
export const EDGE_SHAPE_LABELS: Record<EdgeShape, string> = { default: "曲線", smoothstep: "角を丸めた直角", step: "直角", straight: "直線" };
export type ColumnMode = "default" | "all" | "keys" | "none";
export const COLUMN_MODE_LABELS: Record<ColumnMode, string> = { default: "主キー・外部キー + 他のカラムの数", all: "すべてのカラム", keys: "主キー・外部キーだけ", none: "テーブル名だけ" };

export interface DiagramViewState {
  /** 検索語 (一致したノードを強調し、ほかを薄くする)。保存しない */
  search: string;
  /** 選んだノードのつながりの強調 (0 = しない / 1 / 2 段)。保存しない */
  focus: 0 | 1 | 2;
  /** 「この範囲だけ表示」: 中心のノードと、何段まで。null = 全部。保存しない */
  scope: { ids: string[]; depth: number } | null;
  edgeShape: EdgeShape;
  /** 隠す線の種類 (図ごとの種類の名前) */
  hiddenKinds: string[];
  columnMode: ColumnMode;
  /** 折りたたんでいるグループ (画面フロー) */
  collapsedGroups: string[];
  /** 基準との差分を色で見せる */
  diff: boolean;
}

export const DEFAULT_DIAGRAM_VIEW: DiagramViewState = { search: "", focus: 0, scope: null, edgeShape: "default", hiddenKinds: [], columnMode: "default", collapsedGroups: [], diff: false };

/** 保存する部分 (検索・強調・範囲・差分は、開き直すたびに白紙) */
export function persistedPart(v: DiagramViewState): Pick<DiagramViewState, "edgeShape" | "hiddenKinds" | "columnMode" | "collapsedGroups"> {
  return { edgeShape: v.edgeShape, hiddenKinds: v.hiddenKinds, columnMode: v.columnMode, collapsedGroups: v.collapsedGroups };
}

export interface DiagramConfig {
  /** 検索に使う文字列 (名前・ID など) */
  textsOf: (node: Node) => string[];
  /** 線の種類 (hiddenKinds と照らす)。無ければ 1 種類 */
  kindOfEdge?: (edge: Edge) => string;
  /** ノードの中身の指紋 (基準との差分)。同じなら同じ文字列 */
  fingerprintOf?: (node: Node) => string;
  /** 読み上げ用の名前 */
  labelOf?: (node: Node) => string;
  /** 折りたたむと小さくするグループの高さ */
  collapsedGroupHeight?: number;
}

export interface Baseline { at: string; nodes: Record<string, { fp: string; label: string }> }

export type DiffKind = "added" | "changed";

/** 基準と比べて、増えた・変わったノード。消えたものは、名前の一覧にする */
export function diffAgainst(nodes: readonly Node[], baseline: Baseline, cfg: Pick<DiagramConfig, "fingerprintOf" | "labelOf">): { kinds: Map<string, DiffKind>; removed: Array<{ id: string; label: string }> } {
  const kinds = new Map<string, DiffKind>();
  const ids = new Set<string>();
  for (const n of nodes) {
    ids.add(n.id);
    const base = baseline.nodes[n.id];
    if (!base) kinds.set(n.id, "added");
    else if (cfg.fingerprintOf && cfg.fingerprintOf(n) !== base.fp) kinds.set(n.id, "changed");
  }
  const removed = Object.entries(baseline.nodes).filter(([id]) => !ids.has(id)).map(([id, v]) => ({ id, label: v.label }));
  return { kinds, removed };
}

export function makeBaseline(nodes: readonly Node[], cfg: Pick<DiagramConfig, "fingerprintOf" | "labelOf">, at = new Date().toISOString()): Baseline {
  const out: Baseline["nodes"] = {};
  for (const n of nodes) out[n.id] = { fp: cfg.fingerprintOf?.(n) ?? "", label: cfg.labelOf?.(n) ?? n.id };
  return { at, nodes: out };
}

/** 短い指紋 (文字列から。衝突は、ここでは問題にしない) */
export function fingerprint(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

const addClass = (cls: string | undefined, add: string) => (cls ? `${cls} ${add}` : add);

export interface Decorated { nodes: Node[]; edges: Edge[]; matchIds: string[]; hiddenNodeCount: number; hiddenEdgeCount: number; diff: { kinds: Map<string, DiffKind>; removed: Array<{ id: string; label: string }> } | null }

/** ノード・線を、見え方に合わせて飾る。元の配列は変えない。何も飾らないときは、元の配列をそのまま返す */
export function decorateDiagram(nodes: Node[], edges: Edge[], view: DiagramViewState, cfg: DiagramConfig, baseline: Baseline | null): Decorated {
  const plain = view.search === "" && view.focus === 0 && !view.scope && view.edgeShape === "default" && view.hiddenKinds.length === 0 && view.columnMode === "default" && view.collapsedGroups.length === 0 && !(view.diff && baseline);
  const diff = view.diff && baseline ? diffAgainst(nodes, baseline, cfg) : null;
  if (plain && !cfg.labelOf) return { nodes, edges, matchIds: [], hiddenNodeCount: 0, hiddenEdgeCount: 0, diff };

  const selected = nodes.filter((n) => n.selected && !n.hidden).map((n) => n.id);
  const geomEdges = edges.map((e) => ({ source: e.source, target: e.target }));

  // 見せる範囲 (関連 N 段)
  let visible: Set<string> | null = null;
  if (view.scope && view.scope.ids.length > 0) visible = neighborhood(geomEdges, view.scope.ids.filter((id) => nodes.some((n) => n.id === id)), view.scope.depth);
  // 折りたたんだグループの中身
  const collapsed = new Set(view.collapsedGroups);
  const insideCollapsed = (n: Node) => !!n.parentId && collapsed.has(n.parentId);

  const matchIds = view.search.trim() ? searchNodeIds(nodes.map((n) => ({ id: n.id, texts: cfg.textsOf(n) })), view.search) : [];
  const matchSet = new Set(matchIds);
  const focusSet = view.focus > 0 && selected.length > 0 ? neighborhood(geomEdges, selected, view.focus) : null;
  const searching = view.search.trim() !== "";

  const hiddenIds = new Set<string>();
  const outNodes = nodes.map((n) => {
    const hide = (visible ? !visible.has(n.id) && !(n.type === "groupNode") : false) || insideCollapsed(n);
    if (hide) hiddenIds.add(n.id);
    let className = n.className;
    if (searching) className = addClass(className, matchSet.has(n.id) ? "dgm-hit" : "dgm-dim");
    else if (focusSet) className = addClass(className, focusSet.has(n.id) ? "dgm-focus" : "dgm-dim");
    const dk = diff?.kinds.get(n.id);
    if (dk) className = addClass(className, dk === "added" ? "dgm-added" : "dgm-changed");
    let data = n.data;
    if (view.columnMode !== "default" && n.type === "erTableNode") data = { ...n.data, columnMode: view.columnMode };
    if (n.type === "groupNode") data = { ...n.data, collapsed: collapsed.has(n.id) };
    const next: Node = { ...n, hidden: n.hidden || hide, ...(className !== n.className ? { className } : {}), data };
    if (cfg.labelOf) next.ariaLabel = cfg.labelOf(n);
    if (n.type === "groupNode" && collapsed.has(n.id)) next.style = { ...n.style, height: cfg.collapsedGroupHeight ?? 44 };
    return next;
  });

  const hiddenKinds = new Set(view.hiddenKinds);
  let hiddenEdgeCount = 0;
  const outEdges = edges.map((e) => {
    const kind = cfg.kindOfEdge?.(e) ?? "";
    const hide = hiddenKinds.has(kind) || hiddenIds.has(e.source) || hiddenIds.has(e.target);
    if (hide) hiddenEdgeCount++;
    let className = e.className;
    if (searching) { if (!(matchSet.has(e.source) || matchSet.has(e.target))) className = addClass(className, "dgm-dim"); }
    else if (focusSet && !(focusSet.has(e.source) && focusSet.has(e.target))) className = addClass(className, "dgm-dim");
    const next: Edge = { ...e, hidden: e.hidden || hide, ...(className !== e.className ? { className } : {}) };
    if (view.edgeShape !== "default") next.type = view.edgeShape;
    return next;
  });

  return { nodes: outNodes, edges: outEdges, matchIds, hiddenNodeCount: hiddenIds.size, hiddenEdgeCount, diff };
}
