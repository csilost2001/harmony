// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-2 (#1145): StepCard.tsx の `step.kind === "displayUpdate"` body を抽出。

import type { Step } from "../../../../types/action";
import type { StepCardBodyBaseProps } from "./types";

export type DisplayUpdateStepCardBodyProps = StepCardBodyBaseProps;

export function DisplayUpdateStepCardBody({
  step,
  onChange,
  onCommit,
}: DisplayUpdateStepCardBodyProps) {
  return (
    <div className="row g-2 mb-2">
      <div className="col-12">
        <label className="form-label">更新対象</label>
        <input
          className="form-control form-control-sm"
          value={step.target}
          onChange={(e) => onChange({ target: e.target.value } as Partial<Step>)}
          onBlur={onCommit}
          placeholder="メッセージ表示、一覧テーブル更新 等"
        />
      </div>
    </div>
  );
}
