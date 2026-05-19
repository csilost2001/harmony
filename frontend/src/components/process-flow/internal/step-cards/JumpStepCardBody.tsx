// Phase-2 (#1145): StepCard.tsx の `step.kind === "jump"` body を抽出。
// #1016 follow-up (2026-05-20): generic StepCardBodyBaseProps<JumpStep> で type narrow、@ts-nocheck 除去。

import type { JumpStep, LocalId } from "../../../../types/v3";
import { JumpTargetSelector } from "../../JumpTargetSelector";
import type { StepCardBodyBaseProps } from "./types";

export type JumpStepCardBodyProps = StepCardBodyBaseProps<JumpStep>;

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
          onChange={(val) => onChange({ jumpTo: val as LocalId })}
          onBlur={onCommit}
        />
      </div>
    </div>
  );
}
