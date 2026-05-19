// Phase-2 (#1145): StepCard.tsx の `step.kind === "log"` body を抽出 (#402)。

import type { LogStep } from "../../../../types/v3";
import { LogStepPanel } from "../../LogStepPanel";
import type {
  StepCardBodyBaseProps,
  StepCardBodyCatalogProps,
} from "./types";

export interface LogStepCardBodyProps
  extends StepCardBodyBaseProps<LogStep>,
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
      onChange={(patch) => onChange(patch)}
      onCommit={onCommit}
      conventions={conventions ?? null}
    />
  );
}
