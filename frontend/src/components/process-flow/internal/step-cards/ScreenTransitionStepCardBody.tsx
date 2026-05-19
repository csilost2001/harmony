// Phase-2 (#1145): StepCard.tsx の `step.kind === "screenTransition"` body を抽出。
// #1016 follow-up (2026-05-20): generic StepCardBodyBaseProps<ScreenTransitionStep> で type narrow、
// 副次 silent bug fix: `targetScreenName` field を削除 (v3 schema 上 ScreenTransitionStep.targetScreenName 不在、
// unevaluatedProperties: false で reject される silent field だった)。
// 画面名表示は screens lookup で派生 (永続化しない)。

import type { ScreenTransitionStep, ScreenId } from "../../../../types/v3";
import type {
  StepCardBodyBaseProps,
  StepCardBodyScreenProps,
} from "./types";

export interface ScreenTransitionStepCardBodyProps
  extends StepCardBodyBaseProps<ScreenTransitionStep>,
    StepCardBodyScreenProps {}

export function ScreenTransitionStepCardBody({
  step,
  screens,
  onChange,
  onCommit,
}: ScreenTransitionStepCardBodyProps) {
  // 画面名は targetScreenId から lookup で派生 (永続化しない、#1016 silent bug fix)
  const screenDisplay = screens.find((s) => s.id === step.targetScreenId)?.name;
  return (
    <div className="row g-2 mb-2">
      <div className="col-12">
        <label className="form-label">遷移先画面</label>
        <select
          className="form-select form-select-sm"
          value={step.targetScreenId ?? ""}
          onChange={(e) => onChange({ targetScreenId: e.target.value as ScreenId })}
          onBlur={onCommit}
        >
          <option value="">（選択）</option>
          {screens.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        {screenDisplay && (
          <div className="form-text text-muted" style={{ fontSize: "0.75rem" }}>
            選択中: {screenDisplay}
          </div>
        )}
      </div>
    </div>
  );
}
