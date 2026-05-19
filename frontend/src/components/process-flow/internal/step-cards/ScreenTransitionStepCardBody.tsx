// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-2 (#1145): StepCard.tsx の `step.kind === "screenTransition"` body を抽出。

import type { Step } from "../../../../types/v3";
import type {
  StepCardBodyBaseProps,
  StepCardBodyScreenProps,
} from "./types";

export interface ScreenTransitionStepCardBodyProps
  extends StepCardBodyBaseProps,
    StepCardBodyScreenProps {}

export function ScreenTransitionStepCardBody({
  step,
  screens,
  onChange,
  onCommit,
}: ScreenTransitionStepCardBodyProps) {
  return (
    <div className="row g-2 mb-2">
      <div className="col-12">
        <label className="form-label">遷移先画面</label>
        <select
          className="form-select form-select-sm"
          value={step.targetScreenId ?? ""}
          onChange={(e) => {
            const s = screens.find((s) => s.id === e.target.value);
            onChange({ targetScreenId: e.target.value, targetScreenName: s?.name ?? e.target.value } as Partial<Step>);
          }}
        >
          <option value="">（選択または手入力）</option>
          {screens.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <input
          className="form-control form-control-sm mt-1"
          value={step.targetScreenName}
          onChange={(e) => onChange({ targetScreenName: e.target.value } as Partial<Step>)}
          onBlur={onCommit}
          placeholder="画面名を直接入力"
        />
      </div>
    </div>
  );
}
