// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-2 (#1145): StepCard.tsx の `step.kind === "jump"` body を抽出。

import type { Step } from "../../../../types/v3";
import { JumpTargetSelector } from "../../JumpTargetSelector";
import type { StepCardBodyBaseProps } from "./types";

export type JumpStepCardBodyProps = StepCardBodyBaseProps;

export function JumpStepCardBody({
  step,
  allSteps,
  onChange,
  onCommit,
}: JumpStepCardBodyProps) {
  return (
    <div className="row g-2 mb-2">
      <div className="col-12">
        <label className="form-label">ジャンプ先</label>
        <JumpTargetSelector
          value={step.jumpTo}
          allSteps={allSteps}
          excludeStepId={step.id}
          onChange={(val) => onChange({ jumpTo: val } as Partial<Step>)}
          onBlur={onCommit}
        />
      </div>
    </div>
  );
}
