// Phase-2 (#1145): StepCard.tsx の `step.kind === "transactionScope"` body を抽出 (#415)。

import type { TransactionScopeStep } from "../../../../types/v3";
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
  extends StepCardBodyBaseProps<TransactionScopeStep>,
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
      onChange={(patch) => onChange(patch)}
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
