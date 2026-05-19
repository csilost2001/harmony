// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-2 (#1145): StepCard.tsx の `step.kind === "audit"` body を抽出 (#402)。

import type { Step } from "../../../../types/v3";
import { AuditStepPanel } from "../../AuditStepPanel";
import type {
  StepCardBodyBaseProps,
  StepCardBodyCatalogProps,
} from "./types";

export interface AuditStepCardBodyProps
  extends StepCardBodyBaseProps,
    Pick<StepCardBodyCatalogProps, "conventions"> {}

export function AuditStepCardBody({
  step,
  onChange,
  onCommit,
  conventions,
}: AuditStepCardBodyProps) {
  return (
    <AuditStepPanel
      step={step}
      onChange={(patch) => onChange(patch as Partial<Step>)}
      onCommit={onCommit}
      conventions={conventions ?? null}
    />
  );
}
