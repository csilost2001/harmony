// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-2 (#1145): StepCard.tsx の `step.kind === "transactionScope"` body を抽出 (#415)。

import type { Step } from "../../../../types/v3";
import { TransactionScopeStepPanel } from "../../TransactionScopeStepPanel";
import type {
  StepCardBodyBaseProps,
  StepCardBodyCatalogProps,
  StepCardBodyTableProps,
  StepCardBodyScreenProps,
  StepCardBodyCommonGroupsProps,
  StepCardBodyNavigationProps,
} from "./types";

export interface TransactionScopeStepCardBodyProps
  extends StepCardBodyBaseProps,
    StepCardBodyCatalogProps,
    StepCardBodyTableProps,
    StepCardBodyScreenProps,
    StepCardBodyCommonGroupsProps,
    StepCardBodyNavigationProps {}

export function TransactionScopeStepCardBody({
  step,
  allSteps,
  tables,
  screens,
  commonGroups,
  validationErrors,
  conventions,
  group,
  onChange,
  onCommit,
  onNavigateCommon,
}: TransactionScopeStepCardBodyProps) {
  return (
    <TransactionScopeStepPanel
      step={step}
      onChange={(patch) => onChange(patch as Partial<Step>)}
      onCommit={onCommit}
      group={group}
      allSteps={allSteps}
      tables={tables}
      screens={screens}
      commonGroups={commonGroups}
      validationErrors={validationErrors}
      conventions={conventions ?? null}
      onNavigateCommon={onNavigateCommon}
    />
  );
}
