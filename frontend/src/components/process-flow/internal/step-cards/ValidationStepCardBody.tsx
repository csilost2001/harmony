// Phase-2 (#1145): StepCard.tsx の `step.kind === "validation"` body を抽出。
// 振る舞いの変更は無し (純粋なファイル分割)。
// #1016 follow-up (2026-05-20): generic StepCardBodyBaseProps<ValidationStep> で type narrow。
// 副次 silent bug fix:
//   - ngResponseRef → ngResponseId (v3 ValidationInlineBranch.ngResponseId、ngResponseRef は schema 外)
//   - string-form ok/ng の handling 除去 (v3 ValidationInlineBranch.ok/ng は Step[] のみ、string は v1/v2 legacy で v3 schema 不一致)

import type { ValidationStep, LocalId, ExpressionString } from "../../../../types/v3";
import { ValidationRulesPanel } from "../../ValidationRulesPanel";
import type { StepCardBodyBaseProps, StepCardBodyCatalogProps } from "./types";

export interface ValidationStepCardBodyProps
  extends StepCardBodyBaseProps<ValidationStep>,
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
            value={step.conditions ?? ""}
            onChange={(e) => onChange({ conditions: e.target.value })}
            onBlur={onCommit}
            placeholder="必須チェック、形式チェック等 (rules[] で構造化済なら補足用)"
          />
        </div>
      </div>
      <ValidationRulesPanel
        rules={step.rules}
        onChange={(rules) => onChange({ rules })}
        conventions={conventions ?? null}
      />
      {step.inlineBranch && (
        <div className="step-inline-branch">
          <div className="step-branch-box ok">
            <div className="step-branch-label">A: OK</div>
            <span className="form-control form-control-sm text-muted" style={{ cursor: "default" }}>
              ステップ {step.inlineBranch.ok.length} 件 (JSON編集)
            </span>
          </div>
          <div className="step-branch-box ng">
            <div className="step-branch-label">B: NG</div>
            <span className="form-control form-control-sm text-muted" style={{ cursor: "default" }}>
              ステップ {step.inlineBranch.ng.length} 件 (JSON編集)
            </span>
          </div>
        </div>
      )}
      {step.inlineBranch && (
        <div className="row g-2 mb-2 mt-1" style={{ fontSize: "0.8rem" }}>
          <div className="col-5">
            <label className="form-label small mb-0">
              NG → responseId
            </label>
            <input
              type="text"
              className="form-control form-control-sm"
              value={step.inlineBranch.ngResponseId ?? ""}
              onChange={(e) =>
                onChange({
                  inlineBranch: {
                    ...step.inlineBranch!,
                    ngResponseId: (e.target.value || undefined) as LocalId | undefined,
                  },
                })
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
                    ngBodyExpression: (e.target.value || undefined) as ExpressionString | undefined,
                  },
                })
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
