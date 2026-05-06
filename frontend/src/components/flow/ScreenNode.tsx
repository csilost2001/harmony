import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ScreenNode as ScreenNodeData } from "../../types/flow";
import { SCREEN_KIND_LABELS, SCREEN_KIND_ICONS } from "../../types/flow";

type ScreenNodeProps = NodeProps & {
  data: ScreenNodeData;
  selected?: boolean;
};

function ScreenNodeComponent({ data, selected }: ScreenNodeProps) {
  const icon = SCREEN_KIND_ICONS[data.kind] ?? "bi-circle";
  const kindLabel = SCREEN_KIND_LABELS[data.kind] ?? data.kind;

  return (
    <>
      <Handle type="target" position={Position.Top} id="top" />
      <Handle type="target" position={Position.Left} id="left" />
      <div className={`screen-node${selected ? " selected" : ""}`}>
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
