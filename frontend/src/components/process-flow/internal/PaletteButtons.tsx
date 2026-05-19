// Phase-3 (#1145): ProcessFlowEditor.tsx から palette / insert zone 系の小 component を抽出。
// - ToolbarStepButton: 左サイドバー (パレット) のドラッグ可能なステップ種別ボタン
// - StepInsertZone: ステップ間の "+" / paste ドロップゾーン
// - EmptyFlowDropZone: アクションが空の場合の全面ドロップゾーン
// - CustomStepButton: 拡張カスタムステップのプレースホルダーボタン (D&D は別 ISSUE)

import type { ReactNode } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { StepKind as StepType } from "../../../types/v3";
import { STEP_TYPE_LABELS, STEP_TYPE_ICONS, STEP_TYPE_COLORS } from "../../../utils/processFlowMetadata";

export function ToolbarStepButton({
  type,
  onClick,
  disabled = false,
}: {
  type: StepType;
  onClick: () => void;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `toolbar-${type}`,
    data: { kind: "toolbar-step", stepType: type },
    disabled,
  });
  return (
    <button
      ref={setNodeRef}
      {...(disabled ? {} : listeners)}
      {...(disabled ? {} : attributes)}
      className={`step-toolbar-btn${isDragging ? " dragging" : ""}`}
      onClick={onClick}
      title={`${STEP_TYPE_LABELS[type]}（ドラッグで挿入）`}
      disabled={disabled}
      style={isDragging ? { opacity: 0.5, borderColor: STEP_TYPE_COLORS[type] } : undefined}
    >
      <i className={STEP_TYPE_ICONS[type]} />
      {STEP_TYPE_LABELS[type]}
    </button>
  );
}

export function StepInsertZone({
  index,
  onClick,
  onPaste,
  dragVisible,
  disabled = false,
}: {
  index: number;
  onClick: () => void;
  onPaste?: () => void;
  dragVisible?: boolean;
  disabled?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `insert-${index}`,
    data: { kind: "insert-zone", insertIndex: index },
    disabled,
  });
  if (disabled) return null;
  return (
    <div
      ref={setNodeRef}
      className={`step-insert-point${isOver ? " drop-active" : ""}${onPaste ? " has-paste" : ""}${
        dragVisible ? " drag-visible" : ""
      }`}
    >
      <button className="step-insert-btn" onClick={onClick} title="ステップを挿入">
        <i className="bi bi-plus" />
      </button>
      {onPaste && (
        <button className="step-paste-btn" onClick={onPaste} title="ここに貼り付け">
          <i className="bi bi-clipboard-plus me-1" />貼り付け
        </button>
      )}
    </div>
  );
}

export function EmptyFlowDropZone({
  children,
  disabled = false,
}: {
  children: ReactNode;
  disabled?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: "empty-flow-drop",
    data: { kind: "insert-zone", insertIndex: 0 },
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={`step-empty process-flow-empty-drop${isOver ? " drop-active" : ""}`}
    >
      {children}
    </div>
  );
}

export function CustomStepButton({
  id,
  label,
  icon,
  description,
}: {
  id: string;
  label: string;
  icon: string;
  description: string;
}) {
  return (
    <button
      type="button"
      className="step-toolbar-btn"
      disabled
      title={`D&D 配置は別 ISSUE で対応予定: ${id}`}
      aria-disabled="true"
    >
      <i className={icon || "bi bi-puzzle"} />
      {label || id}
      {description ? <span className="visually-hidden">{description}</span> : null}
    </button>
  );
}
