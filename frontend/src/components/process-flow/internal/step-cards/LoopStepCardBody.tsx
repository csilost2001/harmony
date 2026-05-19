// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-2 (#1145): StepCard.tsx の `step.kind === "loop"` body を抽出 (Phase 4 ロジック)。
//
// `loopBodyCollapsed` は本 body 専用の純粋 UI state のため、parent から切り離して内部化。

import { useState } from "react";
import type { LoopConditionMode, LoopKind, Step } from "../../../../types/v3";
import { InlineStepList } from "../InlineStepList";
import type {
  StepCardBodyBaseProps,
  StepCardBodyCatalogProps,
  StepCardBodyTableProps,
  StepCardBodyScreenProps,
  StepCardBodyCommonGroupsProps,
  StepCardBodyNavigationProps,
} from "./types";

export interface LoopStepCardBodyProps
  extends StepCardBodyBaseProps,
    StepCardBodyCatalogProps,
    StepCardBodyTableProps,
    StepCardBodyScreenProps,
    StepCardBodyCommonGroupsProps,
    StepCardBodyNavigationProps {}

export function LoopStepCardBody({
  step,
  allSteps,
  tables,
  screens,
  commonGroups,
  validationErrors,
  conventions,
  group,
  onChange,
  onCommit,
  onNavigateCommon,
  readOnly,
}: LoopStepCardBodyProps) {
  const [loopBodyCollapsed, setLoopBodyCollapsed] = useState(false);

  return (
    <div>
      <div className="loop-kind-radios">
        {(["count", "condition", "collection"] as LoopKind[]).map((k) => (
          <label key={k}>
            <input
              type="radio"
              name={`loopkind-${step.id}`}
              value={k}
              checked={step.loopKind === k}
              onChange={() => onChange({ loopKind: k } as Partial<Step>)}
            />
            {k === "count" ? "回数" : k === "condition" ? "条件" : "コレクション"}
          </label>
        ))}
      </div>

      {step.loopKind === "count" && (
        <div className="form-group">
          <label className="form-label">回数 / 範囲</label>
          <input
            className="form-control form-control-sm"
            value={step.countExpression ?? ""}
            onChange={(e) => onChange({ countExpression: e.target.value } as Partial<Step>)}
            onBlur={onCommit}
            placeholder="例: 3回, 検索結果の件数分"
          />
        </div>
      )}

      {step.loopKind === "condition" && (
        <>
          <div className="form-group mb-2">
            <label className="form-label">条件モード</label>
            <div className="d-flex gap-3 flex-wrap">
              {(["continue", "exit"] as LoopConditionMode[]).map((m) => (
                <label key={m} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "0.82rem", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name={`condmode-${step.id}`}
                    value={m}
                    checked={(step.conditionMode ?? "exit") === m}
                    onChange={() => onChange({ conditionMode: m } as Partial<Step>)}
                  />
                  {m === "continue" ? "条件の間繰り返す (while)" : "条件になるまで繰り返す (until)"}
                </label>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">条件式</label>
            <input
              className="form-control form-control-sm"
              value={step.conditionExpression ?? ""}
              onChange={(e) => onChange({ conditionExpression: e.target.value } as Partial<Step>)}
              onBlur={onCommit}
              placeholder="例: 残件数 > 0"
            />
          </div>
        </>
      )}

      {step.loopKind === "collection" && (
        <div className="form-row-pair">
          <div className="form-group">
            <label className="form-label">コレクション</label>
            <input
              className="form-control form-control-sm"
              value={step.collectionSource ?? ""}
              onChange={(e) => onChange({ collectionSource: e.target.value } as Partial<Step>)}
              onBlur={onCommit}
              placeholder="例: 検索結果"
            />
          </div>
          <div className="form-group">
            <label className="form-label">要素変数名</label>
            <input
              className="form-control form-control-sm"
              value={step.collectionItemName ?? ""}
              onChange={(e) => onChange({ collectionItemName: e.target.value } as Partial<Step>)}
              onBlur={onCommit}
              placeholder="例: ユーザー"
            />
          </div>
        </div>
      )}

      <div className={`loop-body${loopBodyCollapsed ? " collapsed" : ""}`}>
        <div
          className="loop-body-header"
          onClick={() => setLoopBodyCollapsed(!loopBodyCollapsed)}
        >
          <i className="bi bi-arrow-repeat" />
          ループ本体
          <i
            className={`bi bi-chevron-${loopBodyCollapsed ? "right" : "down"} ms-auto`}
            style={{ color: "#94a3b8" }}
          />
        </div>
        {!loopBodyCollapsed && (
          <div className="loop-body-content">
            <InlineStepList
              steps={step.steps}
              parentLabel="L"
              allSteps={allSteps}
              tables={tables}
              screens={screens}
              commonGroups={commonGroups}
              onChange={(newSteps) => onChange({ steps: newSteps } as Partial<Step>)}
              onCommit={onCommit}
              onNavigateCommon={onNavigateCommon}
              validationErrors={validationErrors}
              conventions={conventions}
              group={group}
              readOnly={readOnly}
            />
          </div>
        )}
      </div>
    </div>
  );
}
