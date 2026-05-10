import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ScreenNode as ScreenNodeData } from "../../types/flow";
import { SCREEN_KIND_LABELS, SCREEN_KIND_ICONS } from "../../types/flow";

/** ScreenNode data に注入される marker 集計 (FlowEditor が screenEntities から計算)。 */
type ScreenNodeDataWithMarker = ScreenNodeData & {
  unresolvedCount?: number;
};

type ScreenNodeProps = NodeProps & {
  data: ScreenNodeDataWithMarker;
  selected?: boolean;
};

function ScreenNodeComponent({ data, selected }: ScreenNodeProps) {
  const icon = SCREEN_KIND_ICONS[data.kind] ?? "bi-circle";
  const kindLabel = SCREEN_KIND_LABELS[data.kind] ?? data.kind;
  const unresolvedCount = data.unresolvedCount ?? 0;

  return (
    <>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <div className={`screen-node${selected ? " selected" : ""}`} data-screen-id={data.id} style={{ position: "relative" }}>
        {/* Should-fix #1003: 未解決 marker バッジ — ReactFlow ノードと一体で position / zoom 追従 */}
        {unresolvedCount > 0 && (
          <span
            className="screen-node-marker-badge"
            data-testid="screen-node-marker-badge"
            title={`未解決マーカー ${unresolvedCount} 件`}
          >
            <i className="bi bi-megaphone-fill" style={{ fontSize: 9, marginRight: 2 }} />
            {unresolvedCount}
          </span>
        )}
        <div className="screen-node-header">
          <i className={`bi ${icon} screen-node-icon`} />
          <span className="screen-node-name">{data.name}</span>
        </div>
        {data.thumbnail ? (
          <div className="screen-node-thumbnail">
            <img src={data.thumbnail} alt={data.name} draggable={false} />
          </div>
        ) : (
          <div className="screen-node-body">
            <span className="screen-node-type">
              {kindLabel}
            </span>
            {data.path && (
              <div className="screen-node-path">{data.path}</div>
            )}
            <div className={`screen-node-design-badge${data.hasDesign ? "" : " empty"}`}>
              <i className={`bi ${data.hasDesign ? "bi-brush-fill" : "bi-brush"}`} />
              {data.hasDesign ? "デザイン済み" : "未デザイン"}
            </div>
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Right} id="right" />
    </>
  );
}

export default memo(ScreenNodeComponent);
