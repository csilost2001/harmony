// @ts-nocheck
import type { ReactNode } from "react";
import type {
  Step,
  WorkflowApprover,
  WorkflowPattern,
  WorkflowQuorum,
  WorkflowStep,
} from "../../types/action";
import {
  WORKFLOW_PATTERN_LABELS,
  WORKFLOW_PATTERN_VALUES,
} from "../../types/action";
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";
import { ConvCompletionInput } from "../common/ConvCompletionInput";

interface Props {
  step: WorkflowStep;
  allSteps: Step[];
  conventions?: ConventionsCatalog | null;
  onChange: (patch: Partial<WorkflowStep>) => void;
  onCommit?: () => void;
  renderInlineStepList?: (props: {
    steps: Step[];
    parentLabel: string;
    onChange: (steps: Step[]) => void;
  }) => ReactNode;
}

function normalizePositiveInteger(value: string): number | undefined {
  if (!value) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function WorkflowStepPanel({
  step,
  conventions,
  onChange,
  onCommit,
  renderInlineStepList,
}: Props) {
  const approvers = step.approvers ?? [];
  const roleOptions = Object.entries(conventions?.role ?? {});

  const updateApprover = (index: number, patch: Partial<WorkflowApprover>) => {
    onChange({
      approvers: approvers.map((approver, i) => (
        i === index ? { ...approver, ...patch } : approver
      )),
    });
  };

  const addApprover = () => {
    onChange({
      approvers: [
        ...approvers,
        { role: roleOptions[0]?.[0] ?? "", order: approvers.length + 1 },
      ],
    });
  };

  const removeApprover = (index: number) => {
    onChange({ approvers: approvers.filter((_, i) => i !== index) });
    onCommit?.();
  };

  const roleSelect = (
    value: string,
    onRoleChange: (value: string) => void,
    fieldPath: string,
  ) => (
    <select
      className="form-select form-select-sm"
      value={value}
      onChange={(e) => onRoleChange(e.target.value)}
      onBlur={onCommit}
      data-field-path={fieldPath}
    >
      <option value="">ロールを選択</option>
      {roleOptions.map(([key, role]) => (
        <option key={key} value={key}>
          {role.name ? `${role.name} (${key})` : key}
        </option>
      ))}
      {value && !roleOptions.some(([key]) => key === value) && (
        <option value={value}>{value}</option>
      )}
    </select>
  );

  const updateQuorum = (patch: { type?: WorkflowQuorum["type"]; n?: number }) => {
    const type = patch.type ?? step.quorum?.type ?? "any";
    if (type === "n-of-m") {
      const currentN = step.quorum?.type === "n-of-m" ? step.quorum.n : undefined;
      onChange({ quorum: { type, n: patch.n ?? currentN ?? 1 } });
    } else {
      onChange({ quorum: { type } });
    }
  };

  const updateEscalateTo = (patch: Partial<NonNullable<WorkflowStep["escalateTo"]>>) => {
    const role = (patch.role ?? step.escalateTo?.role ?? "").trim();
    const userExpression = (patch.userExpression ?? step.escalateTo?.userExpression ?? "").trim();
    onChange({
      escalateTo: role || userExpression
        ? {
            ...(role ? { role } : {}),
            ...(userExpression ? { userExpression } : {}),
          }
        : undefined,
    });
  };

  const fallbackStepList = (
    steps: Step[],
    parentLabel: string,
    onStepsChange: (steps: Step[]) => void,
  ) => (
    <div className="inline-step-list">
      {steps.map((child, index) => (
        <div key={child.id} className="d-flex align-items-center gap-2 mb-1">
          <span className="badge text-bg-light">{parentLabel}-{index + 1}</span>
          <span>{child.description || child.id}</span>
          <button
            type="button"
            className="btn btn-sm btn-link text-danger p-0"
            onClick={() => {
              onStepsChange(steps.filter((_, i) => i !== index));
              onCommit?.();
            }}
            title="削除"
          >
            <i className="bi bi-x" />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary py-0"
        onClick={() => {
          onStepsChange([
            ...steps,
            {
              id: `workflow-${parentLabel.toLowerCase()}-${steps.length + 1}`,
              type: "other",
              description: "",
              maturity: "draft",
            },
          ]);
          onCommit?.();
        }}
        style={{ fontSize: "0.75rem" }}
      >
        <i className="bi bi-plus-lg" /> ステップ追加
      </button>
    </div>
  );

  const stepListSection = (
    field: "onApproved" | "onRejected" | "onTimeout",
    label: string,
    parentLabel: string,
  ) => {
    const steps = step[field] ?? [];
    const setSteps = (next: Step[]) => {
      onChange({ [field]: next.length > 0 ? next : undefined } as Partial<WorkflowStep>);
    };
    return (
      <div className="mb-2" data-field-path={field}>
        <label className="form-label">{label}</label>
        {renderInlineStepList
          ? renderInlineStepList({ steps, parentLabel, onChange: setSteps })
          : fallbackStepList(steps, parentLabel, setSteps)}
      </div>
    );
  };

  return (
    <div className="workflow-step-panel" style={{ marginTop: 8 }}>
      <div className="row g-2 mb-2">
        <div className="col-md-6" data-field-path="pattern">
          <label className="form-label">ワークフローパターン</label>
          <select
            className="form-select form-select-sm"
            value={step.pattern}
            onChange={(e) => onChange({ pattern: e.target.value as WorkflowPattern })}
            onBlur={onCommit}
          >
            {WORKFLOW_PATTERN_VALUES.map((pattern) => (
              <option key={pattern} value={pattern}>
                {WORKFLOW_PATTERN_LABELS[pattern]} ({pattern})
              </option>
            ))}
          </select>
        </div>

        <div className="col-md-3" data-field-path="quorum.type">
          <label className="form-label">定足条件</label>
          <select
            className="form-select form-select-sm"
            value={step.quorum?.type ?? ""}
            onChange={(e) => updateQuorum({ type: e.target.value as WorkflowQuorum["type"] })}
            onBlur={onCommit}
          >
            <option value="">未指定</option>
            <option value="all">all</option>
            <option value="any">any</option>
            <option value="majority">majority</option>
            <option value="n-of-m">n-of-m</option>
          </select>
        </div>
        {step.quorum?.type === "n-of-m" && (
          <div className="col-md-3" data-field-path="quorum.n">
            <label className="form-label">必要数 n</label>
            <input
              type="number"
              min={1}
              className="form-control form-control-sm"
              value={step.quorum.n ?? ""}
              onChange={(e) => updateQuorum({ n: normalizePositiveInteger(e.target.value) })}
              onBlur={onCommit}
              placeholder="例: 2"
            />
          </div>
        )}
      </div>

      <div className="mb-2" data-field-path="approvers">
        <div className="d-flex align-items-center justify-content-between mb-1">
          <label className="form-label mb-0">承認者ロール</label>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary py-0"
            onClick={addApprover}
            style={{ fontSize: "0.75rem" }}
          >
            <i className="bi bi-plus-lg" /> 追加
          </button>
        </div>

        {approvers.length === 0 && (
          <div className="text-muted mb-1" style={{ fontSize: "0.78rem" }}>
            承認者ロールを追加してください。
          </div>
        )}

        {approvers.map((approver, index) => (
          <div key={index} className="row g-1 align-items-center mb-1">
            <div className="col-md-4">
              {roleSelect(
                approver.role,
                (value) => updateApprover(index, { role: value }),
                `approvers[${index}].role`,
              )}
            </div>
            <div className="col-md-5" data-field-path={`approvers[${index}].label`}>
              <input
                type="text"
                className="form-control form-control-sm"
                value={approver.label ?? ""}
                onChange={(e) => updateApprover(index, { label: e.target.value || undefined })}
                onBlur={onCommit}
                placeholder="表示名"
              />
            </div>
            <div className="col-md-2" data-field-path={`approvers[${index}].order`}>
              <input
                type="number"
                min={1}
                className="form-control form-control-sm"
                value={approver.order ?? ""}
                onChange={(e) => updateApprover(index, { order: normalizePositiveInteger(e.target.value) })}
                onBlur={onCommit}
                placeholder="順序"
              />
            </div>
            <div className="col-auto">
              <button
                type="button"
                className="btn btn-sm btn-link text-danger p-0"
                onClick={() => removeApprover(index)}
                title="削除"
              >
                <i className="bi bi-x" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {stepListSection("onApproved", "承認成立時ステップ", "OK")}
      {stepListSection("onRejected", "却下時ステップ", "NG")}
      {stepListSection("onTimeout", "期限切れ時ステップ", "TO")}

      <div className="row g-2 mb-2">
        <div className="col-md-6" data-field-path="deadlineExpression">
          <label className="form-label">期限式</label>
          <ConvCompletionInput
            className="form-control form-control-sm"
            value={step.deadlineExpression ?? ""}
            onValueChange={(value) => onChange({ deadlineExpression: value || undefined })}
            onCommit={onCommit}
            conventions={conventions ?? null}
            placeholder="例: @submittedAt + duration('P3D')"
            style={{ fontFamily: "monospace" }}
          />
        </div>
        <div className="col-md-6" data-field-path="escalateAfter">
          <label className="form-label">エスカレーションまで</label>
          <ConvCompletionInput
            className="form-control form-control-sm"
            value={step.escalateAfter ?? ""}
            onValueChange={(value) => onChange({ escalateAfter: value || undefined })}
            onCommit={onCommit}
            conventions={conventions ?? null}
            placeholder="例: duration('P2D')"
            style={{ fontFamily: "monospace" }}
          />
        </div>
      </div>

      <div className="row g-2 mb-2">
        <div className="col-md-6" data-field-path="escalateTo.role">
          <label className="form-label">エスカレーション先ロール</label>
          {roleSelect(
            step.escalateTo?.role ?? "",
            (value) => updateEscalateTo({ role: value }),
            "escalateTo.role",
          )}
        </div>
        <div className="col-md-6" data-field-path="escalateTo.userExpression">
          <label className="form-label">エスカレーション先ユーザー式</label>
          <ConvCompletionInput
            className="form-control form-control-sm"
            value={step.escalateTo?.userExpression ?? ""}
            onValueChange={(value) => updateEscalateTo({ userExpression: value })}
            onCommit={onCommit}
            conventions={conventions ?? null}
            placeholder="例: @managerOf(@employeeId)"
            style={{ fontFamily: "monospace" }}
          />
        </div>
      </div>
    </div>
  );
}
