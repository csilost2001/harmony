// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-2 (#1145): StepCard.tsx の `step.kind === "return"` body を抽出。

import type { Step } from "../../../../types/v3";
import { ConvCompletionInput } from "../../../common/ConvCompletionInput";
import type {
  StepCardBodyBaseProps,
  StepCardBodyCatalogProps,
} from "./types";

export interface ReturnStepCardBodyProps
  extends StepCardBodyBaseProps,
    Pick<StepCardBodyCatalogProps, "conventions"> {}

export function ReturnStepCardBody({
  step,
  onChange,
  onCommit,
  conventions,
}: ReturnStepCardBodyProps) {
  return (
    <div className="row g-2 mb-2">
      <div className="col-6">
        <label className="form-label">
          <i className="bi bi-reply me-1" />
          responseRef (action.responses[].id)
        </label>
        <input
          type="text"
          className="form-control form-control-sm"
          value={step.responseRef ?? ""}
          onChange={(e) => onChange({ responseRef: e.target.value || undefined } as Partial<Step>)}
          onBlur={onCommit}
          placeholder="例: 409-stock-shortage"
        />
      </div>
      <div className="col-6" data-field-path="bodyExpression">
        <label className="form-label">bodyExpression</label>
        <ConvCompletionInput
          className="form-control form-control-sm"
          value={step.bodyExpression ?? ""}
          onValueChange={(v) => onChange({ bodyExpression: v || undefined } as Partial<Step>)}
          onCommit={onCommit}
          conventions={conventions ?? null}
          placeholder="例: { code: 'STOCK_SHORTAGE', detail: @shortageList }"
          style={{ fontFamily: "monospace" }}
        />
      </div>
    </div>
  );
}
