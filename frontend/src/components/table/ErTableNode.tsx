import { memo, useState, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { Column } from "../../types/v3";

/**
 * ErTableNode 表示用の data 型 (v3)。
 * - physicalName: 物理名 (snake_case)
 * - name: 表示名 (display)
 * - fkColumnIds: FK として参照されているカラム id (Constraint.foreignKey 由来) を上位から渡す
 */
export interface ErTableNodeData {
  tableId: string;
  physicalName: string;
  name: string;
  category?: string;
  columns: Column[];
  /** Constraint.foreignKey から導出された FK column.id 集合。未指定なら表示で FK アイコン非表示。 */
  fkColumnIds?: Set<string>;
  [key: string]: unknown;
}

function ErTableNodeComponent({ data, selected }: NodeProps) {
  const d = data as unknown as ErTableNodeData;
  const [expanded, setExpanded] = useState(false);

  const fkSet = d.fkColumnIds ?? new Set<string>();
  const pkColumns = d.columns.filter((c) => c.primaryKey);
  const fkColumns = d.columns.filter((c) => fkSet.has(c.id) && !c.primaryKey);
  const otherColumns = d.columns.filter((c) => !c.primaryKey && !fkSet.has(c.id));
  const hiddenCount = otherColumns.length;

  const toggleExpand = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  }, []);

  const dataTypeShort = (col: Column) => {
    const dt = col.dataType;
    if (dt === "VARCHAR" || dt === "CHAR") return `${dt}(${col.length ?? ""})`;
    if (dt === "DECIMAL") return `DEC(${col.length ?? ""},${col.scale ?? ""})`;
    return dt;
  };

  return (
    <>
      <Handle type="target" position={Position.Top} id="top" className="er-handle" />
      <Handle type="target" position={Position.Left} id="left" className="er-handle" />

      <div className={`er-table-node${selected ? " selected" : ""}`}>
        {/* Header: physicalName をメインに、display name をサブに */}
        <div className="er-node-header">
          <span className="er-node-name">{d.physicalName}</span>
          {d.category && <span className="er-node-category">{d.category}</span>}
        </div>
        <div className="er-node-logical">{d.name}</div>

        <div className="er-node-columns">
          {pkColumns.map((col) => (
            <div key={col.id} className="er-col pk">
              <i className="bi bi-key-fill er-col-icon pk-icon" />
              <span className="er-col-name">{col.physicalName}</span>
              <span className="er-col-type">{dataTypeShort(col)}</span>
            </div>
          ))}

          {fkColumns.map((col) => (
            <div key={col.id} className="er-col fk">
              <i className="bi bi-link-45deg er-col-icon fk-icon" />
              <span className="er-col-name">{col.physicalName}</span>
              <span className="er-col-type">{dataTypeShort(col)}</span>
            </div>
          ))}

          {expanded && otherColumns.map((col) => (
            <div key={col.id} className="er-col">
              <span className="er-col-icon-space" />
              <span className="er-col-name">{col.physicalName}</span>
              <span className="er-col-type">{dataTypeShort(col)}</span>
            </div>
          ))}

          {hiddenCount > 0 && (
            <div className="er-col-toggle" onClick={toggleExpand}>
              {expanded ? (
                <><i className="bi bi-chevron-up" /> 折りたたむ</>
              ) : (
                <><i className="bi bi-chevron-down" /> 他 {hiddenCount} カラム</>
              )}
            </div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} id="bottom" className="er-handle" />
      <Handle type="source" position={Position.Right} id="right" className="er-handle" />
    </>
  );
}

export default memo(ErTableNodeComponent);
