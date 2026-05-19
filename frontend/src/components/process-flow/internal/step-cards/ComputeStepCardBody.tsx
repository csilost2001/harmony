// Phase-2 (#1145): StepCard.tsx の `step.kind === "compute"` body を抽出。

import type { ComputeStep } from "../../../../types/v3";
import { ConvCompletionInput } from "../../../common/ConvCompletionInput";
import type {
  StepCardBodyBaseProps,
  StepCardBodyCatalogProps,
} from "./types";

export interface ComputeStepCardBodyProps
  extends StepCardBodyBaseProps<ComputeStep>,
    Pick<StepCardBodyCatalogProps, "conventions"> {}

export function ComputeStepCardBody({
  step,
  onChange,
  onCommit,
  conventions,
}: ComputeStepCardBodyProps) {
  return (
    <div className="row g-2 mb-2" data-field-path="expression">
      <div className="col-12">
        <label className="form-label">
          <i className="bi bi-calculator me-1" />
          代入式 (expression)
        </label>
        <ConvCompletionInput
          className="form-control form-control-sm"
          value={step.expression}
          onValueChange={(v) => onChange({ expression: v })}
          onCommit={onCommit}
          conventions={conventions ?? null}
          placeholder="例: Math.floor(@subtotal * 0.10) / @subtotal + @taxAmount"
          style={{ fontFamily: "monospace" }}
        />
      </div>
    </div>
  );
}
