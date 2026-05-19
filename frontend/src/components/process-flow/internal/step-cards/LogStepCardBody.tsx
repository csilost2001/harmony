// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-2 (#1145): StepCard.tsx の `step.kind === "log"` body を抽出 (#402)。

import type { Step } from "../../../../types/v3";
import { LogStepPanel } from "../../LogStepPanel";
import type {
  StepCardBodyBaseProps,
  StepCardBodyCatalogProps,
} from "./types";

export interface LogStepCardBodyProps
  extends StepCardBodyBaseProps,
    Pick<StepCardBodyCatalogProps, "conventions"> {}

export function LogStepCardBody({
  step,
  onChange,
  onCommit,
  conventions,
}: LogStepCardBodyProps) {
  return (
    <LogStepPanel
      step={step}
      onChange={(patch) => onChange(patch as Partial<Step>)}
      onCommit={onCommit}
      conventions={conventions ?? null}
    />
  );
}
