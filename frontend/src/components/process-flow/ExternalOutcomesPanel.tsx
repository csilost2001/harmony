// @ts-nocheck
import { useState } from "react";
import type {
  ExternalSystemStep,
  ExternalCallOutcome,
  ExternalCallOutcomeSpec,
  OtherStep,
  Step,
} from "../../types/action";
import { EXTERNAL_CALL_OUTCOME_VALUES } from "../../types/action";
import { generateUUID } from "../../utils/uuid";

interface Props {
  step: ExternalSystemStep;
  onChange: (patch: Partial<ExternalSystemStep>) => void;
  onCommit?: () => void;
}

const ACTIONS: Array<{ value: "continue" | "abort" | "compensate"; label: string }> = [
  { value: "continue", label: "continue (続行)" },
  { value: "abort", label: "abort (中断)" },
  { value: "compensate", label: "compensate (補償)" },
];

const OUTCOME_LABEL: Record<ExternalCallOutcome, string> = {
  success: "成功",
  failure: "失敗",
  timeout: "タイムアウト",
};

/**
 * ExternalSystemStep.outcomes の編集パネル (#220)。
 * 3 outcome (success/failure/timeout) + sideEffects[] 編集。
 * sideEffects は簡易エディタ (type + description のペア)。複雑な step はまだ JSON 直接編集。
 */
export function ExternalOutcomesPanel({ step, onChange, onCommit }: Props) {
  const [expanded, setExpanded] = useState(!!step.outcomes && Object.keys(step.outcomes).length > 0);

  const outcomes = step.outcomes ?? {};

  const setOutcome = (key: ExternalCallOutcome, patch: Partial<ExternalCallOutcomeSpec>) => {
    const current = outcomes[key] ?? { action: "continue" as const };
    const next = { ...outcomes, [key]: { ...current, ...patch } };
    onChange({ outcomes: next });
  };

  const clearOutcome = (key: ExternalCallOutcome) => {
    const next = { ...outcomes };
    delete next[key];
    onChange({ outcomes: Object.keys(next).length > 0 ? next : undefined });
  };

  const addSideEffect = (key: ExternalCallOutcome) => {
    const spec = outcomes[key] ?? { action: "continue" as const };
    const newStep: OtherStep = {
      id: generateUUID(),
      type: "other",
      description: "",
      maturity: "draft",
    };
    const sideEffects = [...(spec.sideEffects ?? []), newStep as Step];
    setOutcome(key, { sideEffects });
  };

  const updateSideEffect = (key: ExternalCallOutcome, idx: number, patch: Partial<Step>) => {
    const spec = outcomes[key];
    if (!spec?.sideEffects) return;
    const next = spec.sideEffects.map((s, i) => (i === idx ? ({ ...s, ...patch } as Step) : s));
    setOutcome(key, { sideEffects: next });
  };

  const removeSideEffect = (key: ExternalCallOutcome, idx: number) => {
    const spec = outcomes[key];
    if (!spec?.sideEffects) return;
    const next = spec.sideEffects.filter((_, i) => i !== idx);
    setOutcome(key, { sideEffects: next.length > 0 ? next : undefined });
  };

  if (!expanded) {
    const count = Object.keys(outcomes).length;
    return (
      <button
        type="button"
        className="btn btn-sm btn-link text-muted p-0"
        onClick={() => setExpanded(true)}
        style={{ fontSize: "0.75rem" }}
      >
        <i className="bi bi-diagram-3 me-1" />
        outcomes ({count} 件) — クリックで編集
      </button>
    );
  }

  return (
    <div className="external-outcomes-panel" style={{ marginTop: 6, border: "1px solid #e2e8f0", borderRadius: 4, padding: 8 }}>
      <div className="d-flex align-items-center justify-content-between mb-2">
        <button
          type="button"
          className="btn btn-sm btn-link p-0 text-dark"
          onClick={() => setExpanded(false)}
          style={{ fontSize: "0.85rem" }}
        >
          <i className="bi bi-chevron-down me-1" />
          <i className="bi bi-diagram-3 me-1" />
          outcomes
        </button>
      </div>

      {EXTERNAL_CALL_OUTCOME_VALUES.map((key) => {
        const spec = outcomes[key];
        return (
          <div key={key} className="mb-2 p-2" style={{ background: "#f8fafc", borderRadius: 4, fontSize: "0.8rem" }}>
            <div className="d-flex align-items-center gap-2 mb-1">
              <strong style={{ width: 100 }}>{OUTCOME_LABEL[key]} ({key}):</strong>
              {spec ? (
                <>
                  <select
                    className="form-select form-select-sm"
                    value={spec.action}
                    onChange={(e) => setOutcome(key, { action: e.target.value as "continue" | "abort" | "compensate" })}
                    style={{ width: "auto", fontSize: "0.8rem" }}
                  >
                    {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                  <input
                    type="text"
                    className="form-control form-control-sm"
                    value={spec.description ?? ""}
                    onChange={(e) => setOutcome(key, { description: e.target.value || undefined })}
                    onBlur={() => onCommit?.()}
                    placeholder="description (任意)"
                    style={{ fontSize: "0.8rem" }}
                  />
                  <select
                    className="form-select form-select-sm"
                    value={spec.sameAs ?? ""}
                    onChange={(e) => setOutcome(key, { sameAs: e.target.value as ExternalCallOutcome || undefined })}
                    style={{ width: "auto", fontSize: "0.8rem" }}
                    title="他 outcome の定義を流用"
                  >
                    <option value="">sameAs: —</option>
                    {EXTERNAL_CALL_OUTCOME_VALUES.filter((k) => k !== key).map((k) => (
                      <option key={k} value={k}>sameAs: {k}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn btn-sm btn-link text-danger p-0"
                    onClick={() => clearOutcome(key)}
                    title="outcome 定義を削除"
                  >
                    <i className="bi bi-x" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary py-0"
                  onClick={() => setOutcome(key, { action: "continue" })}
                  style={{ fontSize: "0.75rem" }}
                >
                  <i className="bi bi-plus-lg" /> 定義を追加
                </button>
              )}
            </div>
            {spec && spec.jumpTo !== undefined && (
              <div className="d-flex align-items-center gap-1 mb-1" style={{ fontSize: "0.75rem" }}>
                <span className="text-muted" style={{ width: 80 }}>jumpTo:</span>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={spec.jumpTo}
                  onChange={(e) => setOutcome(key, { jumpTo: e.target.value || undefined })}
                  onBlur={() => onCommit?.()}
                  style={{ fontSize: "0.75rem" }}
                />
              </div>
            )}
            {spec && !spec.sameAs && (
              <div style={{ marginLeft: 100 }}>
                <div className="d-flex align-items-center gap-1 mb-1" style={{ fontSize: "0.75rem" }}>
                  <span className="text-muted">sideEffects ({spec.sideEffects?.length ?? 0}):</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-secondary py-0"
                    onClick={() => addSideEffect(key)}
                    style={{ fontSize: "0.7rem" }}
                  >
                    <i className="bi bi-plus-lg" /> 追加
                  </button>
                </div>
                {spec.sideEffects?.map((se, i) => (
                  <div key={se.id ?? i} className="d-flex align-items-center gap-1 mb-1" style={{ fontSize: "0.75rem" }}>
                    <select
                      className="form-select form-select-sm"
                      value={se.type}
                      onChange={(e) => updateSideEffect(key, i, { type: e.target.value as Step["type"] } as Partial<Step>)}
                      style={{ width: 110, fontSize: "0.75rem" }}
                    >
                      <option value="other">other</option>
                      <option value="dbAccess">dbAccess</option>
                      <option value="externalSystem">externalSystem</option>
                      <option value="compute">compute</option>
                    </select>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={se.description ?? ""}
                      onChange={(e) => updateSideEffect(key, i, { description: e.target.value })}
                      onBlur={() => onCommit?.()}
                      placeholder="description (詳細は JSON で)"
                      style={{ fontSize: "0.75rem" }}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-link text-danger p-0"
                      onClick={() => removeSideEffect(key, i)}
                    >
                      <i className="bi bi-x" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
