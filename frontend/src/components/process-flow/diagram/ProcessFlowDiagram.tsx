/**
 * 処理フローの図 (構造化フローチャート)。layoutFlow の配置結果を SVG で描く。
 * クリックでステップを選択、ダブルクリックでカード表示の該当ステップを開く。
 */
import { useMemo, useState } from "react";
import type { ActionDefinition } from "../../../types/v3";
import { layoutFlow, type DiagramEdge, type DiagramNode, type FlowContext } from "./flowStructure";

export interface ProcessFlowDiagramProps {
  action: ActionDefinition;
  ctx: FlowContext;
  selectedStepIds: ReadonlySet<string>;
  onSelectStep: (stepId: string) => void;
  onOpenStep: (stepId: string) => void;
}

const ZOOMS = [0.6, 0.8, 1, 1.2];

function edgePath(e: DiagramEdge): string {
  return e.points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
}

function NodeShape({ n, selected }: { n: DiagramNode; selected: boolean }) {
  const cls = `pfd-node pfd-tone-${n.tone}${selected ? " is-selected" : ""}${n.conditional ? " is-conditional" : ""}`;
  if (n.shape === "diamond") {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    return (
      <g className={cls}>
        <polygon points={`${cx},${n.y} ${n.x + n.w},${cy} ${cx},${n.y + n.h} ${n.x},${cy}`} />
        <text x={cx} y={cy - 3} textAnchor="middle" className="pfd-caption">{n.caption}</text>
        <text x={cx} y={cy + 13} textAnchor="middle" className="pfd-text">{n.text}</text>
      </g>
    );
  }
  if (n.shape === "pill") {
    return (
      <g className={cls}>
        <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={n.h / 2} />
        <text x={n.x + n.w / 2} y={n.y + n.h / 2 + 4} textAnchor="middle" className="pfd-text">
          <tspan className="pfd-caption-inline">{n.caption}</tspan>{n.text ? `  ${n.text}` : ""}
        </text>
      </g>
    );
  }
  return (
    <g className={cls}>
      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={6} />
      <rect x={n.x} y={n.y} width={4} height={n.h} className="pfd-stripe" />
      <text x={n.x + 12} y={n.y + 16} className="pfd-caption">{n.caption}</text>
      <text x={n.x + 12} y={n.y + 33} className="pfd-text">{n.text}</text>
      {n.sub && <text x={n.x + 12} y={n.y + 48} className="pfd-sub">{n.sub}</text>}
    </g>
  );
}

export function ProcessFlowDiagram({ action, ctx, selectedStepIds, onSelectStep, onOpenStep }: ProcessFlowDiagramProps) {
  const layout = useMemo(() => layoutFlow(action, ctx), [action, ctx]);
  const [zoom, setZoom] = useState(1);

  return (
    <div className="pfd-root" data-testid="process-flow-diagram">
      <div className="pfd-toolbar">
        <span className="pfd-legend">
          <span className="pfd-legend-item"><i className="pfd-swatch pfd-tone-db" />DB</span>
          <span className="pfd-legend-item"><i className="pfd-swatch pfd-tone-decision" />分岐</span>
          <span className="pfd-legend-item"><i className="pfd-swatch pfd-frame-tx" />トランザクション</span>
          <span className="pfd-legend-item"><i className="pfd-swatch pfd-frame-loop" />繰り返し</span>
          <span className="pfd-legend-item"><i className="pfd-swatch pfd-tone-error" />異常終了</span>
        </span>
        <div className="pfd-zoom" role="group" aria-label="拡大率">
          {ZOOMS.map((z) => (
            <button key={z} type="button" className={zoom === z ? "active" : ""} onClick={() => setZoom(z)}>{Math.round(z * 100)}%</button>
          ))}
        </div>
      </div>
      <div className="pfd-scroll">
        <svg
          width={layout.width * zoom}
          height={layout.height * zoom}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          role="img"
          aria-label={`${action.name} の処理フロー図`}
        >
          <defs>
            <marker id="pfd-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" className="pfd-arrowhead" />
            </marker>
            <marker id="pfd-arrow-error" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" className="pfd-arrowhead-error" />
            </marker>
          </defs>
          {layout.frames.map((f) => (
            <g
              key={f.id}
              className={`pfd-frame pfd-frame-${f.kind}${f.stepId && selectedStepIds.has(f.stepId) ? " is-selected" : ""}`}
              onClick={f.stepId ? () => onSelectStep(f.stepId!) : undefined}
              onDoubleClick={f.stepId ? () => onOpenStep(f.stepId!) : undefined}
              data-step-id={f.stepId}
            >
              <rect x={f.x} y={f.y} width={f.w} height={f.h} rx={8} />
              <text x={f.x + 10} y={f.y + 16} className="pfd-frame-label">{f.label}</text>
            </g>
          ))}
          {layout.edges.map((e, i) => (
            <g key={i} className={`pfd-edge pfd-edge-${e.tone ?? "normal"}`}>
              <path d={edgePath(e)} markerEnd={e.arrow ? `url(#${e.tone === "error" ? "pfd-arrow-error" : "pfd-arrow"})` : undefined} />
              {e.label && e.points.length >= 4 && (
                // 分岐の枝: 枝の縦線の右側、矢印の途中に置く (矢印・ひし形と重ならない)
                <text x={e.points[3][0] + 6} y={(e.points[2][1] + e.points[3][1]) / 2 + 4} className="pfd-edge-label">{e.label}</text>
              )}
            </g>
          ))}
          {layout.nodes.map((n) => (
            <g
              key={n.id}
              className="pfd-hit"
              onClick={n.stepId ? () => onSelectStep(n.stepId!) : undefined}
              onDoubleClick={n.stepId ? () => onOpenStep(n.stepId!) : undefined}
              data-step-id={n.stepId}
              data-testid={n.stepId ? `pfd-node-${n.stepId}` : undefined}
            >
              <title>{`${n.caption}: ${n.text}${n.sub ? `\n${n.sub}` : ""}${n.conditional ? "\n(実行条件あり)" : ""}`}</title>
              <NodeShape n={n} selected={!!n.stepId && selectedStepIds.has(n.stepId)} />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
