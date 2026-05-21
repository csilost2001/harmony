// Phase-2 (#1145): StepCard.tsx の `step.kind === "dbAccess"` body を抽出。
// #1016 follow-up (2026-05-20): generic StepCardBodyBaseProps<DbAccessStep> で type narrow、@ts-nocheck 除去。
// Phase-3 (#1255): SQL body textarea に @conv / @stepResult / @inputs / @fieldErrors 補完を追加。

import type { DbAccessStep, DbOperation, TableId, ErrorCode } from "../../../../types/v3";
import { DB_OPERATION_LABELS } from "../../../../utils/processFlowMetadata";
import { DB_OPS } from "../stepCardConstants";
import type { StepCardBodyBaseProps, StepCardBodyCatalogProps, StepCardBodyTableProps } from "./types";
import { ReferenceCompletionTextarea } from "../../../common/ReferenceCompletionTextarea";
import { convResolver } from "../../../../utils/reference-completer/convResolver";
import { ALL_PROCESS_FLOW_SCOPE_RESOLVERS } from "../../../../utils/reference-completer/processFlowScopeResolver";

export interface DbAccessStepCardBodyProps
  extends StepCardBodyBaseProps<DbAccessStep>,
    StepCardBodyTableProps,
    Partial<StepCardBodyCatalogProps> {}

export function DbAccessStepCardBody({
  step,
  tables,
  onChange,
  onCommit,
  conventions,
  group,
}: DbAccessStepCardBodyProps) {
  const sqlResolvers = [convResolver, ...ALL_PROCESS_FLOW_SCOPE_RESOLVERS];
  const sqlCtx = { conventions: conventions ?? null, flow: group ?? undefined };
  return (
    <>
      <div className="form-group">
        <label className="form-label">テーブル</label>
        <select
          className="form-select form-select-sm"
          value={step.tableId ?? ""}
          onChange={(e) => {
            onChange({ tableId: (e.target.value || undefined) as TableId | undefined });
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
            onChange={(e) => onChange({ operation: e.target.value as DbOperation })}
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
            onChange={(e) => onChange({ fields: e.target.value })}
            onBlur={onCommit}
            placeholder="概要"
          />
        </div>
      </div>
      <div className="form-group" data-field-path="sql">
        <label className="form-label">完全 SQL (sql、fields より優先)</label>
        <ReferenceCompletionTextarea
          value={step.sql ?? ""}
          onValueChange={(v) => onChange({ sql: v || undefined })}
          onCommit={onCommit}
          resolvers={sqlResolvers}
          ctx={sqlCtx}
          className="form-control form-control-sm"
          rows={2}
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
                  onChange({ affectedRowsCheck: undefined });
                } else {
                  onChange({
                    affectedRowsCheck: {
                      operator: e.target.value as ">" | ">=" | "=" | "<" | "<=",
                      expected: step.affectedRowsCheck?.expected ?? 0,
                      onViolation: step.affectedRowsCheck?.onViolation ?? "throw",
                      errorCode: step.affectedRowsCheck?.errorCode,
                    },
                  });
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
                  })}
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
                  })}
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
                      errorCode: (e.target.value || undefined) as ErrorCode | undefined,
                    },
                  })}
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
