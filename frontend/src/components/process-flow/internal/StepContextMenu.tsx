// Phase-3 (#1145): ProcessFlowEditor.tsx からステップカードの右クリックコンテキストメニューを抽出。
// 通常モード ⇔ サブステップ追加 (subType picker) モードの切替を内部 prop 経由で受ける。

import type { StepKind as StepType } from "../../../types/v3";
import { STEP_TYPE_ICONS, STEP_TYPE_LABELS, STEP_TYPE_COLORS } from "../../../utils/processFlowMetadata";
import { ALL_SUB_STEP_TYPES } from "./stepCardConstants";

export interface StepContextMenuProps {
  x: number;
  y: number;
  stepId: string;
  /** subType picker mode (サブステップ追加候補一覧を表示) */
  subTypePickerOpen: boolean;
  /** クリップボードが空かどうかで「貼り付け」項目を出すか決める */
  hasClipboard: boolean;
  /** subType picker 切替 */
  onToggleSubTypePicker: (open: boolean) => void;
  /** 「前/後ろに挿入」(other ステップ) */
  onInsertBefore: () => void;
  onInsertAfter: () => void;
  /** 「前/後ろに貼り付け」 */
  onPasteBefore: () => void;
  onPasteAfter: () => void;
  /** 単一ステップ操作 */
  onCopy: () => void;
  onCut: () => void;
  onDuplicate: () => void;
  onAddSubStep: (kind: StepType) => void;
  /** AI 依頼 (group / step lookup は親側で実施済の前提) */
  onAskAi: () => void;
  onDelete: () => void;
}

export function StepContextMenu({
  x,
  y,
  stepId: _stepId,
  subTypePickerOpen,
  hasClipboard,
  onToggleSubTypePicker,
  onInsertBefore,
  onInsertAfter,
  onPasteBefore,
  onPasteAfter,
  onCopy,
  onCut,
  onDuplicate,
  onAddSubStep,
  onAskAi,
  onDelete,
}: StepContextMenuProps) {
  return (
    <div
      className="step-context-menu"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
    >
      {!subTypePickerOpen ? (
        <>
          <button className="step-context-menu-item" onClick={onInsertBefore}>
            <i className="bi bi-plus-circle" /> 前に挿入
          </button>
          <button className="step-context-menu-item" onClick={onInsertAfter}>
            <i className="bi bi-plus-square" /> 後に挿入
          </button>
          {hasClipboard && (
            <>
              <button className="step-context-menu-item" onClick={onPasteBefore}>
                <i className="bi bi-clipboard-plus" /> 前に貼り付け
              </button>
              <button className="step-context-menu-item" onClick={onPasteAfter}>
                <i className="bi bi-clipboard-plus" /> 後に貼り付け
              </button>
            </>
          )}
          <div className="step-context-menu-sep" />
          <button className="step-context-menu-item" onClick={onCopy}>
            <i className="bi bi-files" /> コピー
          </button>
          <button className="step-context-menu-item" onClick={onCut}>
            <i className="bi bi-scissors" /> カット
          </button>
          <button className="step-context-menu-item" onClick={onDuplicate}>
            <i className="bi bi-copy" /> 複製
          </button>
          <button
            className="step-context-menu-item"
            onClick={() => onToggleSubTypePicker(true)}
          >
            <i className="bi bi-diagram-2" /> サブステップ追加 ▶
          </button>
          <div className="step-context-menu-sep" />
          <button className="step-context-menu-item" onClick={onAskAi}>
            <i className="bi bi-robot" /> このステップを AI に依頼
          </button>
          <button className="step-context-menu-item danger" onClick={onDelete}>
            <i className="bi bi-trash" /> 削除
          </button>
        </>
      ) : (
        <>
          <button
            className="step-context-menu-item"
            onClick={() => onToggleSubTypePicker(false)}
          >
            <i className="bi bi-arrow-left" /> 戻る
          </button>
          <div className="step-context-menu-sep" />
          {ALL_SUB_STEP_TYPES.map((t: StepType) => (
            <button
              key={t}
              className="step-context-menu-item"
              onClick={() => onAddSubStep(t)}
            >
              <i className={`bi ${STEP_TYPE_ICONS[t]}`} style={{ color: STEP_TYPE_COLORS[t] }} />
              {" "}
              {STEP_TYPE_LABELS[t]}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
