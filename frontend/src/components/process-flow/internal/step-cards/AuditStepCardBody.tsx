// Phase-2 (#1145): StepCard.tsx の `step.kind === "audit"` body を抽出 (#402)。
// #1016 follow-up (2026-05-20): generic StepCardBodyBaseProps<AuditStep> で type narrow、@ts-nocheck 除去。

import type { AuditStep } from "../../../../types/v3";
import { AuditStepPanel } from "../../AuditStepPanel";
import type {
  StepCardBodyBaseProps,
  StepCardBodyCatalogProps,
} from "./types";

export interface AuditStepCardBodyProps
  extends StepCardBodyBaseProps<AuditStep>,
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
      onChange={onChange}
      onCommit={onCommit}
      conventions={conventions ?? null}
    />
  );
}
