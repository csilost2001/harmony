// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-2 (#1145): StepCard.tsx の `step.kind === "validation"` body を抽出。
// 振る舞いの変更は無し (純粋なファイル分割)。

import type { Step } from "../../../../types/v3";
import { ValidationRulesPanel } from "../../ValidationRulesPanel";
import type { StepCardBodyBaseProps, StepCardBodyCatalogProps } from "./types";

export interface ValidationStepCardBodyProps
  extends StepCardBodyBaseProps,
    Pick<StepCardBodyCatalogProps, "conventions"> {}

export function ValidationStepCardBody({
  step,
  onChange,
  onCommit,
  conventions,
}: ValidationStepCardBodyProps) {
  return (
    <>
      <div className="row g-2 mb-2" data-field-path="conditions">
        <div className="col-12">
          <label className="form-label">バリデーション条件 (自由記述)</label>
          <input
            className="form-control form-control-sm"
            value={step.conditions}
            onChange={(e) => onChange({ conditions: e.target.value } as Partial<Step>)}
            onBlur={onCommit}
            placeholder="必須チェック、形式チェック等 (rules[] で構造化済なら補足用)"
          />
        </div>
      </div>
      <ValidationRulesPanel
        rules={step.rules}
        onChange={(rules) => onChange({ rules } as Partial<Step>)}
        conventions={conventions ?? null}
      />
      {step.inlineBranch && (
        <div className="step-inline-branch">
          <div className="step-branch-box ok">
            <div className="step-branch-label">A: OK</div>
            {typeof step.inlineBranch.ok === "string" ? (
              <input
                className="form-control form-control-sm"
                value={step.inlineBranch.ok}
                onChange={(e) =>
                  onChange({ inlineBranch: { ...step.inlineBranch!, ok: e.target.value } } as Partial<Step>)
                }
                placeholder="OK時の処理"
                onBlur={onCommit}
              />
            ) : (
              <span className="form-control form-control-sm text-muted" style={{ cursor: "default" }}>
                ステップ {step.inlineBranch.ok.length} 件 (JSON編集)
              </span>
            )}
          </div>
          <div className="step-branch-box ng">
            <div className="step-branch-label">B: NG</div>
            {typeof step.inlineBranch.ng === "string" ? (
              <input
                className="form-control form-control-sm"
                value={step.inlineBranch.ng}
                onChange={(e) =>
                  onChange({ inlineBranch: { ...step.inlineBranch!, ng: e.target.value } } as Partial<Step>)
                }
                placeholder="NG時の処理"
                onBlur={onCommit}
              />
            ) : (
              <span className="form-control form-control-sm text-muted" style={{ cursor: "default" }}>
                ステップ {step.inlineBranch.ng.length} 件 (JSON編集)
              </span>
            )}
          </div>
        </div>
      )}
      {step.inlineBranch && (
        <div className="row g-2 mb-2 mt-1" style={{ fontSize: "0.8rem" }}>
          <div className="col-5">
            <label className="form-label small mb-0">
              NG → responseRef
            </label>
            <input
              type="text"
              className="form-control form-control-sm"
              value={step.inlineBranch.ngResponseRef ?? ""}
              onChange={(e) =>
                onChange({
                  inlineBranch: {
                    ...step.inlineBranch!,
                    ngResponseRef: e.target.value || undefined,
                  },
                } as Partial<Step>)
              }
              onBlur={onCommit}
              placeholder="例: 400-validation"
              style={{ fontSize: "0.8rem" }}
            />
          </div>
          <div className="col-7">
            <label className="form-label small mb-0">
              NG bodyExpression
            </label>
            <input
              type="text"
              className="form-control form-control-sm"
              value={step.inlineBranch.ngBodyExpression ?? ""}
              onChange={(e) =>
                onChange({
                  inlineBranch: {
                    ...step.inlineBranch!,
                    ngBodyExpression: e.target.value || undefined,
                  },
                } as Partial<Step>)
              }
              onBlur={onCommit}
              placeholder="例: { code: 'VALIDATION', fieldErrors: @fieldErrors }"
              style={{ fontSize: "0.8rem", fontFamily: "monospace" }}
            />
          </div>
        </div>
      )}
    </>
  );
}
