// Phase-3 (#1145): ProcessFlowEditor.tsx からアクション追加モーダルを抽出。

import type { ActionTrigger } from "../../../types/v3";
import { ALL_TRIGGERS, getActionTriggerLabel } from "./actionTriggerConstants";

export interface AddActionModalProps {
  name: string;
  trigger: ActionTrigger;
  onChangeName: (name: string) => void;
  onChangeTrigger: (trigger: ActionTrigger) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function AddActionModal({
  name,
  trigger,
  onChangeName,
  onChangeTrigger,
  onSubmit,
  onCancel,
}: AddActionModalProps) {
  return (
    <div className="process-flow-modal-overlay" onClick={onCancel}>
      <div className="process-flow-modal" onClick={(e) => e.stopPropagation()}>
        <h6>アクション追加</h6>
        <div className="form-group">
          <label className="form-label">アクション名 *</label>
          <input
            className="form-control form-control-sm"
            value={name}
            onChange={(e) => onChangeName(e.target.value)}
            placeholder="例: 登録ボタン、検索ボタン"
            autoFocus
          />
        </div>
        <div className="form-group">
          <label className="form-label">トリガー</label>
          <select
            className="form-select form-select-sm"
            value={trigger}
            onChange={(e) => onChangeTrigger(e.target.value as ActionTrigger)}
          >
            {ALL_TRIGGERS.map((t) => (
              <option key={t} value={t}>
                {getActionTriggerLabel(t)}
              </option>
            ))}
          </select>
        </div>
        <div className="process-flow-modal-footer">
          <button className="btn btn-outline-secondary btn-sm" onClick={onCancel}>
            キャンセル
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={onSubmit}
            disabled={!name.trim()}
          >
            追加
          </button>
        </div>
      </div>
    </div>
  );
}
