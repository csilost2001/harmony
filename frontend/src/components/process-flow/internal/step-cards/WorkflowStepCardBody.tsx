// Phase-2 (#1145): StepCard.tsx の `step.kind === "workflow"` body を抽出。

import type { WorkflowStep } from "../../../../types/v3";
import { WorkflowStepPanel } from "../../WorkflowStepPanel";
import { InlineStepList } from "../InlineStepList";
import type {
  StepCardBodyBaseProps,
  StepCardBodyCatalogProps,
  StepCardBodyTableProps,
  StepCardBodyScreenProps,
  StepCardBodyCommonGroupsProps,
  StepCardBodyNavigationProps,
} from "./types";

export interface WorkflowStepCardBodyProps
  extends StepCardBodyBaseProps<WorkflowStep>,
    StepCardBodyCatalogProps,
    StepCardBodyTableProps,
    StepCardBodyScreenProps,
    StepCardBodyCommonGroupsProps,
    StepCardBodyNavigationProps {}

export function WorkflowStepCardBody({
  step,
  allSteps,
  tables,
  screens,
  commonGroups,
  validationErrors,
  conventions,
  onChange,
  onCommit,
  onNavigateCommon,
  readOnly,
}: WorkflowStepCardBodyProps) {
  return (
    <WorkflowStepPanel
      step={step}
      allSteps={allSteps}
      conventions={conventions ?? null}
      onChange={(patch) => onChange(patch)}
      onCommit={onCommit}
      renderInlineStepList={({ steps, parentLabel, onChange: onStepsChange }) => (
        <InlineStepList
          steps={steps}
          parentLabel={parentLabel}
          allSteps={allSteps}
          tables={tables}
          screens={screens}
          commonGroups={commonGroups}
          onChange={onStepsChange}
          onCommit={onCommit}
          onNavigateCommon={onNavigateCommon}
          validationErrors={validationErrors}
          conventions={conventions}
          readOnly={readOnly}
        />
      )}
    />
  );
}
