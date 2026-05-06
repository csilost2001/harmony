// @ts-nocheck
import { useState } from "react";
import type {
  Step,
  StepType,
  TransactionScopeStep,
  TransactionIsolationLevel,
  TransactionPropagation,
  ProcessFlow,
} from "../../types/action";
import {
  STEP_TYPE_LABELS,
  STEP_TYPE_ICONS,
  STEP_TYPE_COLORS,
} from "../../types/action";
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";
import type { ValidationError } from "../../utils/actionValidation";
import { createDefaultStep } from "../../store/processFlowStore";
import { generateUUID } from "../../utils/uuid";
import { StepCard } from "./StepCard";

interface Props {
  step: TransactionScopeStep;
  onChange: (patch: Partial<TransactionScopeStep>) => void;
  onCommit?: () => void;
  /** context.catalogs.errors (rollbackOn の候補取得用) */
  group?: ProcessFlow | null;
  /** 子ステップ描画用 */
  allSteps: Step[];
  tables: { id: string; physicalName: string; name: string }[];
  screens: { id: string; name: string }[];
  commonGroups: { id: string; name: string }[];
  validationErrors?: ValidationError[];
  conventions?: ConventionsCatalog | null;
  onNavigateCommon: (refId: string) => void;
}

const ISOLATION_LEVELS: Array<{ value: TransactionIsolationLevel; label: string }> = [
  { value: "READ_COMMITTED", label: "READ_COMMITTED (commit 済データのみ可視・既定)" },
  { value: "REPEATABLE_READ", label: "REPEATABLE_READ (同 TX 内で同じ行は安定)" },
  { value: "SERIALIZABLE", label: "SERIALIZABLE (直列実行と等価・最厳)" },
];

const PROPAGATIONS: Array<{ value: TransactionPropagation; label: string }> = [
  { value: "REQUIRED", label: "REQUIRED (既存 TX に参加・既定)" },
  { value: "REQUIRES_NEW", label: "REQUIRES_NEW (既存を一時停止して新規 TX)" },
  { value: "NESTED", label: "NESTED (savepoint で部分 rollback 可)" },
];

// ─── サブステップ管理用の InlineStepList (TransactionScopeStep 用ローカル版) ──
// StepCard 内の InlineStepList と同型だが、再利用の都合で本コンポーネント内に置く。

const ALL_SUB_STEP_TYPES: StepType[] = [
  "validation", "dbAccess", "externalSystem", "commonProcess",
  "screenTransition", "displayUpdate", "branch", "loop",
  "loopBreak", "loopContinue", "jump", "compute", "return", "other",
  "log", "audit", "transactionScope",
  "eventPublish", "eventSubscribe", "closing", "cdc",
];

interface InlineStepListProps {
  steps: Step[];
  parentLabel: string;
  allSteps: Step[];
  tables: { id: string; physicalName: string; name: string }[];
  screens: { id: string; name: string }[];
  commonGroups: { id: string; name: string }[];
  onChange: (steps: Step[]) => void;
  onCommit?: () => void;
  onNavigateCommon: (refId: string) => void;
  validationErrors?: ValidationError[];
  conventions?: ConventionsCatalog | null;
  /** ネストした transactionScope 等で context.catalogs.errors を参照するために必要 (#415) */
  group?: ProcessFlow | null;
}

function InlineStepList({
  steps,
  parentLabel,
  allSteps,
  tables,
  screens,
  commonGroups,
  onChange,
  onCommit,
  onNavigateCommon,
  validationErrors,
  conventions,
  group,
}: InlineStepListProps) {
  const [showTypePicker, setShowTypePicker] = useState(false);

  const addStep = (type: StepType) => {
    const newStep = createDefaultStep(type);
    onChange([...steps, newStep]);
    onCommit?.();
    setShowTypePicker(false);
  };

  return (
    <div className="inline-step-list">
      {steps.map((step, si) => (
        <div key={step.id} className="mb-1">
          <StepCard
            step={step}
            index={si}
            label={`${parentLabel}-${si + 1}`}
            allSteps={allSteps}
            tables={tables}
            screens={screens}
            commonGroups={commonGroups}
            onChange={(changes) => {
              const arr = steps.slice();
              arr[si] = { ...arr[si], ...changes } as Step;
              onChange(arr);
            }}
            onCommit={onCommit}
            onMoveUp={si > 0 ? () => {
              const arr = steps.slice();
              [arr[si - 1], arr[si]] = [arr[si], arr[si - 1]];
              onChange(arr);
              onCommit?.();
            } : undefined}
            onMoveDown={si < steps.length - 1 ? () => {
              const arr = steps.slice();
              [arr[si], arr[si + 1]] = [arr[si + 1], arr[si]];
              onChange(arr);
              onCommit?.();
            } : undefined}
            onDelete={() => {
              onChange(steps.filter((s) => s.id !== step.id));
              onCommit?.();
            }}
            onDuplicate={() => {
              const clone = JSON.parse(JSON.stringify(step)) as Step;
              clone.id = generateUUID();
              const arr = steps.slice();
              arr.splice(si + 1, 0, clone);
              onChange(arr);
              onCommit?.();
            }}
            onAddSubStep={(type) => {
              const newSub = createDefaultStep(type);
              const arr = steps.slice();
              arr[si] = { ...arr[si], subSteps: [...(arr[si].subSteps ?? []), newSub] } as Step;
              onChange(arr);
              onCommit?.();
            }}
            onContextMenu={(e) => e.preventDefault()}
            onNavigateCommon={onNavigateCommon}
            depth={1}
            validationErrors={validationErrors}
            conventions={conventions}
            group={group}
          />
        </div>
      ))}
      <div className="inline-step-add">
        <button className="inline-add-btn" onClick={() => setShowTypePicker(!showTypePicker)}>
          <i className="bi bi-plus" /> ステップを追加
        </button>
        {showTypePicker && (
          <div className="inline-type-picker">
            {ALL_SUB_STEP_TYPES.map((t) => (
              <button key={t} className="inline-type-btn" onClick={() => addStep(t)}>
                <i className={`bi ${STEP_TYPE_ICONS[t]}`} style={{ color: STEP_TYPE_COLORS[t] }} />
                {STEP_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function TransactionScopeStepPanel({
  step,
  onChange,
  onCommit,
  group,
  allSteps,
  tables,
  screens,
  commonGroups,
  validationErrors,
  conventions,
  onNavigateCommon,
}: Props) {
  const [onCommitOpen, setOnCommitOpen] = useState((step.onCommit ?? []).length > 0);
  const [onRollbackOpen, setOnRollbackOpen] = useState((step.onRollback ?? []).length > 0);

  // context.catalogs.errors の key 候補
  const errorCodes = Object.keys(group?.context?.catalogs?.errors ?? {});
  const selectedErrorCodes = new Set(step.rollbackOn ?? []);

  const toggleRollbackCode = (code: string) => {
    const next = new Set(selectedErrorCodes);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    const arr = Array.from(next);
    onChange({ rollbackOn: arr.length > 0 ? arr : undefined });
    onCommit?.();
  };

  return (
    <>
      <div className="row g-2 mb-2">
        <div className="col-6" data-field-path="isolationLevel">
          <label className="form-label">
            <i className="bi bi-shield-lock me-1" />
            分離レベル (isolationLevel)
          </label>
          <select
            className="form-select form-select-sm"
            value={step.isolationLevel ?? "READ_COMMITTED"}
            onChange={(e) => {
              onChange({ isolationLevel: e.target.value as TransactionIsolationLevel });
              onCommit?.();
            }}
          >
            {ISOLATION_LEVELS.map((l) => (
              <option key={l.value} value={l.value}>{l.label}</option>
            ))}
          </select>
        </div>
        <div className="col-6" data-field-path="propagation">
          <label className="form-label">
            <i className="bi bi-arrow-repeat me-1" />
            伝播モード (propagation)
          </label>
          <select
            className="form-select form-select-sm"
            value={step.propagation ?? "REQUIRED"}
            onChange={(e) => {
              onChange({ propagation: e.target.value as TransactionPropagation });
              onCommit?.();
            }}
          >
            {PROPAGATIONS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="row g-2 mb-2">
        <div className="col-4" data-field-path="timeoutMs">
          <label className="form-label">
            <i className="bi bi-stopwatch me-1" />
            タイムアウト (timeoutMs)
          </label>
          <div className="input-group input-group-sm">
            <input
              type="number"
              className="form-control form-control-sm"
              value={step.timeoutMs ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ timeoutMs: v === "" ? undefined : Math.max(0, Number(v)) });
              }}
              onBlur={onCommit}
              min={0}
              placeholder="ms"
            />
            <span className="input-group-text">ms</span>
          </div>
        </div>
      </div>

      <div className="row g-2 mb-2" data-field-path="rollbackOn">
        <div className="col-12">
          <label className="form-label">
            <i className="bi bi-arrow-counterclockwise me-1" />
            rollback トリガー (rollbackOn)
            <span className="text-muted ms-1" style={{ fontSize: "0.75rem" }}>
              — errors カタログの key を選択。未選択は「すべての例外で rollback」
            </span>
          </label>
          {errorCodes.length === 0 ? (
            <div className="text-muted small">
              エラーカタログにエントリがありません。エラーカタログタブで先に定義してください。
            </div>
          ) : (
            <div className="d-flex flex-wrap gap-2">
              {errorCodes.map((code) => {
                const checked = selectedErrorCodes.has(code);
                return (
                  <label
                    key={code}
                    className="form-check-label small d-inline-flex align-items-center gap-1"
                    style={{ cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={checked}
                      onChange={() => toggleRollbackCode(code)}
                    />
                    <code style={{ fontSize: "0.78rem" }}>{code}</code>
                  </label>
                );
              })}
            </div>
          )}
          {/* エラーカタログに無い不明な rollbackOn コードがあれば警告表示 */}
          {(step.rollbackOn ?? [])
            .filter((c) => !errorCodes.includes(c))
            .map((c) => (
              <div key={c} className="text-danger small mt-1">
                <i className="bi bi-exclamation-triangle me-1" />
                未知の errorCode: <code>{c}</code> (エラーカタログに追加してください)
                <button
                  type="button"
                  className="btn btn-sm btn-link text-danger p-0 ms-2"
                  onClick={() => toggleRollbackCode(c)}
                  title="この rollbackOn から削除"
                >
                  <i className="bi bi-x" /> 削除
                </button>
              </div>
            ))}
        </div>
      </div>

      <div className="mb-2" data-field-path="steps">
        <label className="form-label small">
          <i className="bi bi-shield-fill me-1" style={{ color: "#dc2626" }} />
          TX 内のステップ (steps) — atomic 単位で実行
        </label>
        <div className="border rounded p-2" style={{ background: "rgba(220, 38, 38, 0.04)" }}>
          <InlineStepList
            steps={step.steps}
            parentLabel="TX"
            allSteps={allSteps}
            tables={tables}
            screens={screens}
            commonGroups={commonGroups}
            onChange={(newSteps) => onChange({ steps: newSteps })}
            onCommit={onCommit}
            onNavigateCommon={onNavigateCommon}
            validationErrors={validationErrors}
            conventions={conventions}
            group={group}
          />
        </div>
      </div>

      {/* onCommit (折りたたみ) */}
      <div className="mb-2" data-field-path="onCommit">
        <button
          type="button"
          className="btn btn-link btn-sm p-0 d-flex align-items-center gap-1"
          onClick={() => setOnCommitOpen(!onCommitOpen)}
          style={{ fontSize: "0.85rem", textDecoration: "none" }}
        >
          <i className={`bi bi-chevron-${onCommitOpen ? "down" : "right"}`} />
          <i className="bi bi-check2-circle" style={{ color: "#22c55e" }} />
          onCommit (commit 成功後の追加処理、任意)
          {(step.onCommit ?? []).length > 0 && (
            <span className="badge bg-success ms-1" style={{ fontSize: "0.7rem" }}>
              {(step.onCommit ?? []).length}
            </span>
          )}
        </button>
        {onCommitOpen && (
          <div className="border rounded p-2 mt-1" style={{ background: "rgba(34, 197, 94, 0.04)" }}>
            <InlineStepList
              steps={step.onCommit ?? []}
              parentLabel="C"
              allSteps={allSteps}
              tables={tables}
              screens={screens}
              commonGroups={commonGroups}
              onChange={(newSteps) =>
                onChange({ onCommit: newSteps.length > 0 ? newSteps : undefined })
              }
              onCommit={onCommit}
              onNavigateCommon={onNavigateCommon}
              validationErrors={validationErrors}
              conventions={conventions}
              group={group}
            />
          </div>
        )}
      </div>

      {/* onRollback (折りたたみ) */}
      <div className="mb-2" data-field-path="onRollback">
        <button
          type="button"
          className="btn btn-link btn-sm p-0 d-flex align-items-center gap-1"
          onClick={() => setOnRollbackOpen(!onRollbackOpen)}
          style={{ fontSize: "0.85rem", textDecoration: "none" }}
        >
          <i className={`bi bi-chevron-${onRollbackOpen ? "down" : "right"}`} />
          <i className="bi bi-arrow-counterclockwise" style={{ color: "#ef4444" }} />
          onRollback (rollback 後の補償処理、任意)
          {(step.onRollback ?? []).length > 0 && (
            <span className="badge bg-danger ms-1" style={{ fontSize: "0.7rem" }}>
              {(step.onRollback ?? []).length}
            </span>
          )}
        </button>
        {onRollbackOpen && (
          <div className="border rounded p-2 mt-1" style={{ background: "rgba(239, 68, 68, 0.04)" }}>
            <InlineStepList
              steps={step.onRollback ?? []}
              parentLabel="R"
              allSteps={allSteps}
              tables={tables}
              screens={screens}
              commonGroups={commonGroups}
              onChange={(newSteps) =>
                onChange({ onRollback: newSteps.length > 0 ? newSteps : undefined })
              }
              onCommit={onCommit}
              onNavigateCommon={onNavigateCommon}
              validationErrors={validationErrors}
              conventions={conventions}
              group={group}
            />
          </div>
        )}
      </div>
    </>
  );
}
