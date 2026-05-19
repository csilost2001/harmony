// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-2 (#1145): StepCard.tsx の `step.kind === "dbAccess"` body を抽出。

// #1186 Phase 2-D: DbOperation は v3 に固有型なし、local string alias。constants は processFlowMetadata
import type { Step } from "../../../../types/v3";
type DbOperation = string;
import { DB_OPERATION_LABELS } from "../../../../utils/processFlowMetadata";
import { DB_OPS } from "../stepCardConstants";
import type { StepCardBodyBaseProps, StepCardBodyTableProps } from "./types";

export interface DbAccessStepCardBodyProps
  extends StepCardBodyBaseProps,
    StepCardBodyTableProps {}

export function DbAccessStepCardBody({
  step,
  tables,
  onChange,
  onCommit,
}: DbAccessStepCardBodyProps) {
  return (
    <>
      <div className="form-group">
        <label className="form-label">テーブル</label>
        <select
          className="form-select form-select-sm"
          value={step.tableId ?? ""}
          onChange={(e) => {
            onChange({ tableId: e.target.value || undefined } as Partial<Step>);
          }}
        >
          <option value="">（選択）</option>
          {tables.map((t) => (
            <option key={t.id} value={t.id}>{t.name}（{t.physicalName}）</option>
          ))}
        </select>
      </div>
      <div className="form-row-pair">
        <div className="form-group">
          <label className="form-label">操作</label>
          <select
            className="form-select form-select-sm"
            value={step.operation}
            onChange={(e) => onChange({ operation: e.target.value as DbOperation } as Partial<Step>)}
          >
            {DB_OPS.map((op) => (
              <option key={op} value={op}>{DB_OPERATION_LABELS[op]}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">対象フィールド</label>
          <input
            className="form-control form-control-sm"
            value={step.fields ?? ""}
            onChange={(e) => onChange({ fields: e.target.value } as Partial<Step>)}
            onBlur={onCommit}
            placeholder="概要"
          />
        </div>
      </div>
      <div className="form-group" data-field-path="sql">
        <label className="form-label">完全 SQL (sql、fields より優先)</label>
        <textarea
          className="form-control form-control-sm"
          rows={2}
          value={step.sql ?? ""}
          onChange={(e) => onChange({ sql: e.target.value || undefined } as Partial<Step>)}
          onBlur={onCommit}
          placeholder="例: SELECT ... JOIN ... WHERE ... / INSERT ... RETURNING ..."
          style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
        />
      </div>
      {(step.operation === "UPDATE" || step.operation === "DELETE") && (
        <div className="form-group">
          <label className="form-label">
            <i className="bi bi-shield-check me-1" />
            影響行数チェック (affectedRowsCheck)
          </label>
          <div className="d-flex align-items-center gap-1" style={{ fontSize: "0.8rem" }}>
            <select
              className="form-select form-select-sm"
              value={step.affectedRowsCheck?.operator ?? ""}
              onChange={(e) => {
                if (!e.target.value) {
                  onChange({ affectedRowsCheck: undefined } as Partial<Step>);
                } else {
                  onChange({
                    affectedRowsCheck: {
                      operator: e.target.value as ">" | ">=" | "=" | "<" | "<=",
                      expected: step.affectedRowsCheck?.expected ?? 0,
                      onViolation: step.affectedRowsCheck?.onViolation ?? "throw",
                      errorCode: step.affectedRowsCheck?.errorCode,
                    },
                  } as Partial<Step>);
                }
              }}
              style={{ width: "auto" }}
            >
              <option value="">—</option>
              <option value=">">&gt;</option>
              <option value=">=">&gt;=</option>
              <option value="=">=</option>
              <option value="<">&lt;</option>
              <option value="<=">&lt;=</option>
            </select>
            {step.affectedRowsCheck && (
              <>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={step.affectedRowsCheck.expected}
                  onChange={(e) => onChange({
                    affectedRowsCheck: {
                      ...step.affectedRowsCheck!,
                      expected: Number(e.target.value),
                    },
                  } as Partial<Step>)}
                  onBlur={onCommit}
                  style={{ width: 70 }}
                />
                <span className="text-muted">行→</span>
                <select
                  className="form-select form-select-sm"
                  value={step.affectedRowsCheck.onViolation}
                  onChange={(e) => onChange({
                    affectedRowsCheck: {
                      ...step.affectedRowsCheck!,
                      onViolation: e.target.value as "throw" | "abort" | "log" | "continue",
                    },
                  } as Partial<Step>)}
                  style={{ width: "auto" }}
                >
                  <option value="throw">throw</option>
                  <option value="abort">abort</option>
                  <option value="log">log</option>
                  <option value="continue">continue</option>
                </select>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={step.affectedRowsCheck.errorCode ?? ""}
                  onChange={(e) => onChange({
                    affectedRowsCheck: {
                      ...step.affectedRowsCheck!,
                      errorCode: e.target.value || undefined,
                    },
                  } as Partial<Step>)}
                  onBlur={onCommit}
                  placeholder="errorCode (例: STOCK_SHORTAGE)"
                  style={{ width: 200 }}
                />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
