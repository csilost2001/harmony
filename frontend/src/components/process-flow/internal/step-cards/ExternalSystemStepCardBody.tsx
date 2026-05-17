// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-2 (#1145): StepCard.tsx の `step.kind === "externalSystem"` body を抽出。

import type { Step } from "../../../../types/action";
import { ExternalOutcomesPanel } from "../../ExternalOutcomesPanel";
import { trimToUndefined } from "../stepCardConstants";
import type { StepCardBodyBaseProps } from "./types";

export type ExternalSystemStepCardBodyProps = StepCardBodyBaseProps;

export function ExternalSystemStepCardBody({
  step,
  onChange,
  onCommit,
}: ExternalSystemStepCardBodyProps) {
  return (
    <>
      <div className="form-row-pair">
        <div className="form-group">
          <label className="form-label">接続先</label>
          <input
            className="form-control form-control-sm"
            value={step.systemRef ?? ""}
            onChange={(e) => onChange({ systemRef: e.target.value } as Partial<Step>)}
            onBlur={onCommit}
            placeholder="システム名 (context.catalogs.externalSystems のキー)"
          />
        </div>
        <div className="form-group">
          <label className="form-label">プロトコル</label>
          <input
            className="form-control form-control-sm"
            value={step.protocol ?? ""}
            onChange={(e) => onChange({ protocol: e.target.value } as Partial<Step>)}
            onBlur={onCommit}
            placeholder="REST / SOAP / gRPC"
          />
        </div>
      </div>
      <div className="row g-2 mb-2">
        <div className="col-6" data-field-path="operationRef">
          <label className="form-label">operationRef</label>
          <input
            className="form-control form-control-sm"
            data-field-path="operationRef"
            value={step.operationRef ?? ""}
            onChange={(e) => onChange({ operationRef: trimToUndefined(e.target.value) } as Partial<Step>)}
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
            onChange={(e) => onChange({ operationId: trimToUndefined(e.target.value) } as Partial<Step>)}
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
            onChange={(e) => onChange({ requestBodyRef: trimToUndefined(e.target.value) } as Partial<Step>)}
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
            onChange={(e) => onChange({ responseRef: trimToUndefined(e.target.value) } as Partial<Step>)}
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
            onChange={(e) => onChange({ timeoutMs: e.target.value ? Number(e.target.value) : undefined } as Partial<Step>)}
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
              onChange={(e) => onChange({ fireAndForget: e.target.checked || undefined } as Partial<Step>)}
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
                onChange({ retryPolicy: undefined } as Partial<Step>);
              } else {
                onChange({
                  retryPolicy: {
                    maxAttempts: n,
                    backoff: step.retryPolicy?.backoff,
                    initialDelayMs: step.retryPolicy?.initialDelayMs,
                  },
                } as Partial<Step>);
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
                } as Partial<Step>)}
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
                } as Partial<Step>)}
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
        onChange={(patch) => onChange(patch as Partial<Step>)}
        onCommit={onCommit}
      />
    </>
  );
}
