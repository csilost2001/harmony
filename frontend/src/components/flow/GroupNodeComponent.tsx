import { memo } from "react";
import type { NodeProps } from "@xyflow/react";
import type { ScreenGroup } from "../../types/flow";

export type GroupNodeData = ScreenGroup;

type GroupNodeProps = NodeProps & {
  data: GroupNodeData;
  selected?: boolean;
};

const DEFAULT_COLOR = "#6366f1";

function GroupNodeComponent({ data, selected }: GroupNodeProps) {
  const color = data.color ?? DEFAULT_COLOR;

  return (
    <div
      className={`group-node${selected ? " selected" : ""}`}
      style={{
        width: "100%",
        height: "100%",
        borderColor: color,
        backgroundColor: `${color}0d`,
      }}
    >
      <div className="group-node-label" style={{ color }}>
        <i className="bi bi-collection-fill" />
        <span>{data.name}</span>
      </div>
    </div>
  );
}

export default memo(GroupNodeComponent);
