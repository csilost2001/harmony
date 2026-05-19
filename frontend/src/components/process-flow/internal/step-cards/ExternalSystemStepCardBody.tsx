// Phase-2 (#1145): StepCard.tsx の `step.kind === "externalSystem"` body を抽出。
// #1016 follow-up (2026-05-20): generic StepCardBodyBaseProps<ExternalSystemStep> で type narrow、
// 副次 silent bug fix: `protocol` field 入力欄を削除 (v3 schema 上 ExternalSystemStep.protocol 不在、
// unevaluatedProperties: false で reject される silent field だった)。

import type { ExternalSystemStep, Identifier } from "../../../../types/v3";
import { ExternalOutcomesPanel } from "../../ExternalOutcomesPanel";
import { trimToUndefined } from "../stepCardConstants";
import type { StepCardBodyBaseProps } from "./types";

export type ExternalSystemStepCardBodyProps = StepCardBodyBaseProps<ExternalSystemStep>;

export function ExternalSystemStepCardBody({
  step,
  onChange,
  onCommit,
}: ExternalSystemStepCardBodyProps) {
  return (
    <>
      <div className="form-group">
        <label className="form-label">接続先</label>
        <input
          className="form-control form-control-sm"
          value={step.systemRef ?? ""}
          onChange={(e) => onChange({ systemRef: e.target.value as Identifier })}
          onBlur={onCommit}
          placeholder="システム名 (context.catalogs.externalSystems のキー)"
        />
      </div>
      {/* #1016 follow-up (2026-05-20): プロトコル入力欄を削除。
         v3 ExternalSystemStep.protocol は schema に存在せず unevaluatedProperties: false で
         silent reject されていた (実用には httpCall.method or operationRef で表現)。 */}
      <div className="row g-2 mb-2">
        <div className="col-6" data-field-path="operationRef">
          <label className="form-label">operationRef</label>
          <input
            className="form-control form-control-sm"
            data-field-path="operationRef"
            value={step.operationRef ?? ""}
            onChange={(e) => onChange({ operationRef: trimToUndefined(e.target.value) })}
            onBlur={onCommit}
            placeholder="/v1/payment_intents POST"
            style={{ fontFamily: "monospace" }}
          />
        </div>
        <div className="col-6" data-field-path="operationId">
          <label className="form-label">operationId</label>
          <input
            className="form-control form-control-sm"
            data-field-path="operationId"
            value={step.operationId ?? ""}
            onChange={(e) => onChange({ operationId: trimToUndefined(e.target.value) })}
            onBlur={onCommit}
            placeholder="PostPaymentIntents"
            style={{ fontFamily: "monospace" }}
          />
        </div>
      </div>
      <div className="row g-2 mb-2">
        <div className="col-6" data-field-path="requestBodyRef">
          <label className="form-label">requestBodyRef</label>
          <input
            className="form-control form-control-sm"
            data-field-path="requestBodyRef"
            value={step.requestBodyRef ?? ""}
            onChange={(e) => onChange({ requestBodyRef: trimToUndefined(e.target.value) })}
            onBlur={onCommit}
            placeholder="#/components/schemas/PaymentIntentCreateParams"
            style={{ fontFamily: "monospace" }}
          />
        </div>
        <div className="col-6" data-field-path="responseRef">
          <label className="form-label">responseRef</label>
          <input
            className="form-control form-control-sm"
            data-field-path="responseRef"
            value={step.responseRef ?? ""}
            onChange={(e) => onChange({ responseRef: trimToUndefined(e.target.value) })}
            onBlur={onCommit}
            placeholder="#/components/responses/200/content/application~1json/schema"
            style={{ fontFamily: "monospace" }}
          />
        </div>
      </div>
      <div className="row g-2 mb-2 align-items-center" style={{ fontSize: "0.85rem" }}>
        <div className="col-auto">
          <label className="form-label small mb-0">タイムアウト</label>
        </div>
        <div className="col-auto">
          <input
            type="number"
            className="form-control form-control-sm"
            value={step.timeoutMs ?? ""}
            onChange={(e) => onChange({ timeoutMs: e.target.value ? Number(e.target.value) : undefined })}
            onBlur={onCommit}
            placeholder="ms"
            style={{ width: 90 }}
          />
        </div>
        <div className="col-auto text-muted">ms</div>
        <div className="col-auto">
          <label className="form-check-label small">
            <input
              type="checkbox"
              className="form-check-input me-1"
              checked={!!step.fireAndForget}
              onChange={(e) => onChange({ fireAndForget: e.target.checked || undefined })}
            />
            fire-and-forget (同期レスポンス待たない)
          </label>
        </div>
      </div>
      <div className="row g-2 mb-2 align-items-center" style={{ fontSize: "0.8rem" }}>
        <div className="col-auto">
          <label className="form-label small mb-0">リトライ</label>
        </div>
        <div className="col-auto">
          <input
            type="number"
            className="form-control form-control-sm"
            value={step.retryPolicy?.maxAttempts ?? ""}
            onChange={(e) => {
              const n = e.target.value ? Number(e.target.value) : 0;
              if (n <= 0) {
                onChange({ retryPolicy: undefined });
              } else {
                onChange({
                  retryPolicy: {
                    maxAttempts: n,
                    backoff: step.retryPolicy?.backoff,
                    initialDelayMs: step.retryPolicy?.initialDelayMs,
                  },
                });
              }
            }}
            onBlur={onCommit}
            placeholder="maxAttempts"
            style={{ width: 90, fontSize: "0.8rem" }}
          />
        </div>
        {step.retryPolicy && (
          <>
            <div className="col-auto">
              <select
                className="form-select form-select-sm"
                value={step.retryPolicy.backoff ?? ""}
                onChange={(e) => onChange({
                  retryPolicy: {
                    ...step.retryPolicy!,
                    backoff: e.target.value as "fixed" | "exponential" || undefined,
                  },
                })}
                style={{ width: "auto", fontSize: "0.8rem" }}
              >
                <option value="">backoff: —</option>
                <option value="fixed">fixed</option>
                <option value="exponential">exponential</option>
              </select>
            </div>
            <div className="col-auto">
              <input
                type="number"
                className="form-control form-control-sm"
                value={step.retryPolicy.initialDelayMs ?? ""}
                onChange={(e) => onChange({
                  retryPolicy: {
                    ...step.retryPolicy!,
                    initialDelayMs: e.target.value ? Number(e.target.value) : undefined,
                  },
                })}
                onBlur={onCommit}
                placeholder="initialDelayMs"
                style={{ width: 120, fontSize: "0.8rem" }}
              />
            </div>
          </>
        )}
      </div>
      <ExternalOutcomesPanel
        step={step}
        onChange={(patch) => onChange(patch)}
        onCommit={onCommit}
      />
    </>
  );
}
