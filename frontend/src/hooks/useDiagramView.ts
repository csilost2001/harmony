import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edge, Node, Viewport } from "@xyflow/react";
import { viewportShows } from "../utils/diagramGeom";
import {
  DEFAULT_DIAGRAM_VIEW, decorateDiagram, makeBaseline, persistedPart,
  type Baseline, type Decorated, type DiagramConfig, type DiagramViewState,
} from "../utils/diagramView";

const VIEW_PREFIX = "harmony-diagram-view:";
const BASE_PREFIX = "harmony-diagram-baseline:";
const PORT_PREFIX = "harmony-diagram-viewport:";

function read<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}
function write(key: string, value: unknown | null): void {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch { /* 保存できなくても、この画面の中では効く */ }
}

function loadView(key: string): DiagramViewState {
  const p = read<Partial<DiagramViewState>>(VIEW_PREFIX + key) ?? {};
  return {
    ...DEFAULT_DIAGRAM_VIEW,
    edgeShape: (["default", "smoothstep", "straight", "step"] as const).find((s) => s === p.edgeShape) ?? "default",
    hiddenKinds: Array.isArray(p.hiddenKinds) ? p.hiddenKinds.filter((x): x is string => typeof x === "string") : [],
    columnMode: (["default", "all", "keys", "none"] as const).find((s) => s === p.columnMode) ?? "default",
    collapsedGroups: Array.isArray(p.collapsedGroups) ? p.collapsedGroups.filter((x): x is string => typeof x === "string") : [],
  };
}

export interface DiagramViewApi {
  view: DiagramViewState;
  update: (patch: Partial<DiagramViewState>) => void;
  decorated: Decorated;
  baseline: Baseline | null;
  recordBaseline: () => void;
  clearBaseline: () => void;
}

/**
 * 図の見え方 (検索・強調・範囲・線の形と種類・カラム表示・グループの折りたたみ・基準との差分)。
 * 線の形・種類・カラム表示・折りたたみ・基準は、図ごと (key) にブラウザへ覚える。検索・強調・範囲は、開き直すたびに白紙。
 * 返す `decorated.nodes / edges` を ReactFlow に渡す (元の nodes / edges は、保存する座標のために、そのまま使う)。
 */
export function useDiagramView(key: string, nodes: Node[], edges: Edge[], cfg: DiagramConfig): DiagramViewApi {
  const [view, setView] = useState<DiagramViewState>(() => loadView(key));
  const [baseline, setBaseline] = useState<Baseline | null>(() => read<Baseline>(BASE_PREFIX + key));
  const cfgRef = useRef(cfg);
  useEffect(() => { cfgRef.current = cfg; });

  // key が変わったら (別のワークスペースの図になったら)、その key の設定を読み直す
  const [loadedKey, setLoadedKey] = useState(key);
  if (loadedKey !== key) { setLoadedKey(key); setView(loadView(key)); setBaseline(read<Baseline>(BASE_PREFIX + key)); }

  const update = useCallback((patch: Partial<DiagramViewState>) => {
    setView((cur) => {
      const next = { ...cur, ...patch };
      write(VIEW_PREFIX + key, JSON.stringify(persistedPart(next)) === JSON.stringify(persistedPart(DEFAULT_DIAGRAM_VIEW)) ? null : persistedPart(next));
      return next;
    });
  }, [key]);

  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; });
  const recordBaseline = useCallback(() => {
    const b = makeBaseline(nodesRef.current, cfgRef.current);
    setBaseline(b); write(BASE_PREFIX + key, b);
    setView((cur) => ({ ...cur, diff: true }));
  }, [key]);
  const clearBaseline = useCallback(() => { setBaseline(null); write(BASE_PREFIX + key, null); setView((cur) => ({ ...cur, diff: false })); }, [key]);

  // cfg は、呼び出し側が useMemo で持つ (毎回作り直すと、そのたびに飾り直す)
  const decorated = useMemo(() => decorateDiagram(nodes, edges, view, cfg, baseline), [nodes, edges, view, cfg, baseline]);
  return { view, update, decorated, baseline, recordBaseline, clearBaseline };
}

/** 図の表示位置・拡大率を、図ごとに覚える (開き直したとき、前の見ていた場所から始める) */
export function useViewportMemory(key: string) {
  const saved = useRef<Viewport | null>(read<Viewport>(PORT_PREFIX + key));
  const onMoveEnd = useCallback((_e: unknown, vp: Viewport) => {
    if (![vp.x, vp.y, vp.zoom].every(Number.isFinite)) return;
    saved.current = vp;
    write(PORT_PREFIX + key, { x: Math.round(vp.x), y: Math.round(vp.y), zoom: Math.round(vp.zoom * 1000) / 1000 });
  }, [key]);
  /** 覚えた位置があり、図がそこから見えるなら、そこへ。無ければ (図が動いて外に出ているときも) 全体を収める */
  const restoreOrFit = useCallback((setViewport: (vp: Viewport, o?: { duration?: number }) => unknown, fit: () => unknown, now?: { bounds: { x: number; y: number; width: number; height: number }; size: { width: number; height: number } }) => {
    const vp = saved.current;
    if (vp && (!now || viewportShows(vp, now.bounds, now.size))) setViewport(vp, { duration: 0 }); else fit();
  }, []);
  const forget = useCallback(() => { saved.current = null; write(PORT_PREFIX + key, null); }, [key]);
  return useMemo(() => ({ onMoveEnd, restoreOrFit, forget }), [onMoveEnd, restoreOrFit, forget]);
}
