// Phase-2 (#1145): StepCard.tsx の `step.kind === "return"` body を抽出。
// #1016 follow-up (2026-05-20): generic StepCardBodyBaseProps<ReturnStep> で type narrow。
// 副次 silent bug fix: input field 名と書込 field 名を `responseRef` → `responseId` に修正
// (v3 schema ReturnStep.responseId、`responseRef` は schema 外で unevaluatedProperties: false reject)。

import type { ReturnStep, LocalId, ExpressionString } from "../../../../types/v3";
import { ConvCompletionInput } from "../../../common/ConvCompletionInput";
import type {
  StepCardBodyBaseProps,
  StepCardBodyCatalogProps,
} from "./types";

export interface ReturnStepCardBodyProps
  extends StepCardBodyBaseProps<ReturnStep>,
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
          responseId (action.responses[].id)
        </label>
        <input
          type="text"
          className="form-control form-control-sm"
          value={step.responseId ?? ""}
          onChange={(e) => onChange({ responseId: (e.target.value || undefined) as LocalId | undefined })}
          onBlur={onCommit}
          placeholder="例: 409-stock-shortage"
        />
      </div>
      <div className="col-6" data-field-path="bodyExpression">
        <label className="form-label">bodyExpression</label>
        <ConvCompletionInput
          className="form-control form-control-sm"
          value={step.bodyExpression ?? ""}
          onValueChange={(v) => onChange({ bodyExpression: (v || undefined) as ExpressionString | undefined })}
          onCommit={onCommit}
          conventions={conventions ?? null}
          placeholder="例: { code: 'STOCK_SHORTAGE', detail: @shortageList }"
          style={{ fontFamily: "monospace" }}
        />
      </div>
    </div>
  );
}
