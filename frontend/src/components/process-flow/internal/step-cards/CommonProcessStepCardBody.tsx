// Phase-2 (#1145): StepCard.tsx の `step.kind === "commonProcess"` body を抽出。
// #1016 follow-up (2026-05-20): generic StepCardBodyBaseProps<CommonProcessStep> で type narrow、@ts-nocheck 除去。

import type { CommonProcessStep, ProcessFlowId } from "../../../../types/v3";
import type {
  StepCardBodyBaseProps,
  StepCardBodyCommonGroupsProps,
} from "./types";

export interface CommonProcessStepCardBodyProps
  extends StepCardBodyBaseProps<CommonProcessStep>,
    StepCardBodyCommonGroupsProps {}

export function CommonProcessStepCardBody({
  step,
  commonGroups,
  onChange,
  onCommit,
}: CommonProcessStepCardBodyProps) {
  return (
    <>
      <div className="row g-2 mb-2">
        <div className="col-12">
          <label className="form-label">共通処理</label>
          <select
            className="form-select form-select-sm"
            value={step.refId}
            onChange={(e) => {
              // #1016 follow-up: refName は v3 schema 外 field のため除去 (AJV unevaluatedProperties: false で reject される silent bug を解消)
              onChange({ refId: e.target.value as ProcessFlowId });
            }}
          >
            <option value="">（選択）</option>
            {commonGroups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label small">
          <i className="bi bi-arrow-left-right me-1" />
          引数マッピング (argumentMapping、key=value、改行区切り)
        </label>
        <textarea
          className="form-control form-control-sm"
          rows={2}
          value={Object.entries(step.argumentMapping ?? {}).map(([k, v]) => `${k}=${v}`).join("\n")}
          onChange={(e) => {
            const lines = e.target.value.split("\n").map((l) => l.trim()).filter(Boolean);
            const map: Record<string, string> = {};
            for (const line of lines) {
              const eq = line.indexOf("=");
              if (eq > 0) {
                map[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
              }
            }
            onChange({
              argumentMapping: Object.keys(map).length > 0 ? map : undefined,
            });
          }}
          onBlur={onCommit}
          placeholder={"sessionId=@session.id\ntrustedLevel='high'"}
          style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
        />
      </div>
    </>
  );
}
