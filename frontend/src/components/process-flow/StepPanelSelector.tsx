import type { Step } from "../../types/action";

export interface StepPanelSelectorProps {
  step: Step;
  onChange: (step: Step) => void;
}

/**
 * Future integration point for custom step panels.
 *
 * The current ProcessFlow Step union does not include a "custom" step type.
 * StepCard integration is intentionally deferred to a separate issue that can
 * update the ProcessFlow schema and action types together.
 */
export function StepPanelSelector(props: StepPanelSelectorProps): null {
  void props;
  return null;
}
