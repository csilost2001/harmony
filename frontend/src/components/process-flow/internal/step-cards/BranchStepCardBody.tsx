// Phase-2 (#1145): StepCard.tsx の `step.kind === "branch"` body を抽出 (Phase 3 ロジック含む)。
//
// `collapsedBranchIds` は branch body 専用の純粋 UI state のため、parent (StepCard) から
// 切り離して本 sub-component 内に閉じ込めた。branch handler (setBranchAt / moveBranchUp/Down /
// deleteBranch / addBranch / addElseBranch / toggleBranchCollapse) も同様に内部化。
// #1016 follow-up (2026-05-20): generic StepCardBodyBaseProps<BranchStep> で type narrow、@ts-nocheck 除去。

import { useState } from "react";
import type { BranchStep, Branch, ElseBranch, LocalId, ErrorCode } from "../../../../types/v3";
import { generateUUID } from "../../../../utils/uuid";
import { InlineStepList } from "../InlineStepList";
import type {
  StepCardBodyBaseProps,
  StepCardBodyCatalogProps,
  StepCardBodyTableProps,
  StepCardBodyScreenProps,
  StepCardBodyCommonGroupsProps,
  StepCardBodyNavigationProps,
} from "./types";

export interface BranchStepCardBodyProps
  extends StepCardBodyBaseProps<BranchStep>,
    StepCardBodyCatalogProps,
    StepCardBodyTableProps,
    StepCardBodyScreenProps,
    StepCardBodyCommonGroupsProps,
    StepCardBodyNavigationProps {}

export function BranchStepCardBody({
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
}: BranchStepCardBodyProps) {
  const [collapsedBranchIds, setCollapsedBranchIds] = useState<Set<string>>(new Set());

  const toggleBranchCollapse = (branchId: string) => {
    setCollapsedBranchIds((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  };

  const setBranchAt = (idx: number, next: Branch) => {
    const branches = step.branches.slice();
    branches[idx] = next;
    onChange({ branches });
  };

  const moveBranchUp = (idx: number) => {
    if (idx <= 0) return;
    const branches = step.branches.map((b) => ({ ...b }));
    [branches[idx - 1], branches[idx]] = [branches[idx], branches[idx - 1]];
    branches.forEach((b, i) => { b.code = String.fromCharCode(65 + i); });
    onChange({ branches });
    onCommit?.();
  };

  const moveBranchDown = (idx: number) => {
    const branches = step.branches.map((b) => ({ ...b }));
    if (idx >= branches.length - 1) return;
    [branches[idx], branches[idx + 1]] = [branches[idx + 1], branches[idx]];
    branches.forEach((b, i) => { b.code = String.fromCharCode(65 + i); });
    onChange({ branches });
    onCommit?.();
  };

  const deleteBranch = (idx: number) => {
    if (step.branches.length <= 1) return;
    const branches = step.branches.filter((_, i) => i !== idx).map((b, i) => ({
      ...b,
      code: String.fromCharCode(65 + i),
    }));
    onChange({ branches });
    onCommit?.();
  };

  const addBranch = () => {
    const code = String.fromCharCode(65 + step.branches.length);
    const newBranch: Branch = { id: generateUUID() as LocalId, code, condition: { kind: "expression", expression: "" }, steps: [] };
    onChange({ branches: [...step.branches, newBranch] });
    onCommit?.();
  };

  const addElseBranch = () => {
    const elseBranch: ElseBranch = { id: generateUUID() as LocalId, code: "ELSE", steps: [] };
    onChange({ elseBranch });
    onCommit?.();
  };

  return (
    <div className="branch-sections">
      {step.branches.map((br, bi) => {
        const isCollapsed = collapsedBranchIds.has(br.id);
        return (
          <div key={br.id} className={`branch-section${isCollapsed ? " collapsed" : ""}`}>
            <div
              className="branch-section-header"
              onClick={() => toggleBranchCollapse(br.id)}
            >
              <span className="branch-code-badge">{br.code}</span>
              {br.condition?.kind === "tryCatch" ? (
                <div className="d-flex align-items-center gap-1 flex-grow-1" onClick={(e) => e.stopPropagation()}>
                  <span className="badge bg-info text-dark" style={{ fontSize: "0.7rem" }}>tryCatch</span>
                  <input
                    className="form-control form-control-sm"
                    value={br.condition.errorCode}
                    placeholder="errorCode (例: STOCK_SHORTAGE)"
                    onChange={(e) => setBranchAt(bi, {
                      ...br,
                      condition: { kind: "tryCatch", errorCode: e.target.value as ErrorCode },
                    })}
                    onBlur={onCommit}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-link text-muted p-0"
                    title="自由記述に戻す"
                    onClick={() => setBranchAt(bi, { ...br, condition: { kind: "expression", expression: "" } })}
                  >
                    <i className="bi bi-arrow-counterclockwise" />
                  </button>
                </div>
              ) : br.condition?.kind === "expression" ? (
                <>
                  <input
                    className="form-control form-control-sm branch-condition-input"
                    value={br.condition.expression}
                    placeholder="分岐条件 (自由記述)"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setBranchAt(bi, { ...br, condition: { kind: "expression", expression: e.target.value } })}
                    onBlur={onCommit}
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-link text-muted p-0"
                    title="tryCatch variant に切替"
                    onClick={(e) => {
                      e.stopPropagation();
                      setBranchAt(bi, {
                        ...br,
                        condition: { kind: "tryCatch", errorCode: "" as ErrorCode },
                      });
                    }}
                    style={{ flexShrink: 0 }}
                  >
                    <i className="bi bi-shield-exclamation" />
                  </button>
                </>
              ) : (
                // affectedRowsZero / externalOutcome 等の専用 UI 未対応 kind
                // 現状は kind 名 + 「expression に戻す」ボタンのみ提供 (#954)
                <div className="d-flex align-items-center gap-1 flex-grow-1" onClick={(e) => e.stopPropagation()}>
                  <span className="badge bg-secondary text-white" style={{ fontSize: "0.7rem" }}>{br.condition?.kind ?? "(unknown)"}</span>
                  <span className="text-muted small">専用 UI 未対応 — JSON で編集してください</span>
                  <button
                    type="button"
                    className="btn btn-sm btn-link text-muted p-0"
                    title="expression に戻す"
                    onClick={() => setBranchAt(bi, { ...br, condition: { kind: "expression", expression: "" } })}
                  >
                    <i className="bi bi-arrow-counterclockwise" />
                  </button>
                </div>
              )}
              {!readOnly && bi > 0 && (
                <button
                  className="step-card-menu-btn"
                  title="上に移動"
                  onClick={(e) => { e.stopPropagation(); moveBranchUp(bi); }}
                >
                  <i className="bi bi-chevron-up" />
                </button>
              )}
              {!readOnly && bi < step.branches.length - 1 && (
                <button
                  className="step-card-menu-btn"
                  title="下に移動"
                  onClick={(e) => { e.stopPropagation(); moveBranchDown(bi); }}
                >
                  <i className="bi bi-chevron-down" />
                </button>
              )}
              {!readOnly && step.branches.length > 1 && (
                <button
                  className="step-card-menu-btn danger"
                  title="分岐を削除"
                  onClick={(e) => { e.stopPropagation(); deleteBranch(bi); }}
                >
                  <i className="bi bi-trash" />
                </button>
              )}
              <i
                className={`bi bi-chevron-${isCollapsed ? "right" : "down"}`}
                style={{ color: "#94a3b8", flexShrink: 0 }}
              />
            </div>
            {!isCollapsed && (
              <div className="branch-section-body">
                <InlineStepList
                  steps={br.steps}
                  parentLabel={br.code}
                  allSteps={allSteps}
                  tables={tables}
                  screens={screens}
                  commonGroups={commonGroups}
                  onChange={(newSteps) => setBranchAt(bi, { ...br, steps: newSteps })}
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
        );
      })}

      {/* ELSE分岐 */}
      {step.elseBranch && (() => {
        const el = step.elseBranch;
        const isCollapsed = collapsedBranchIds.has(el.id);
        return (
          <div className={`branch-section else${isCollapsed ? " collapsed" : ""}`}>
            <div
              className="branch-section-header"
              onClick={() => toggleBranchCollapse(el.id)}
            >
              <span className="branch-code-badge">ELSE</span>
              <span style={{ flex: 1, fontSize: "0.78rem", color: "#64748b" }}>
                その他の場合
              </span>
              {!readOnly && <button
                className="step-card-menu-btn danger"
                title="ELSE分岐を削除"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange({ elseBranch: undefined });
                  onCommit?.();
                }}
              >
                <i className="bi bi-trash" />
              </button>}
              <i
                className={`bi bi-chevron-${isCollapsed ? "right" : "down"}`}
                style={{ color: "#94a3b8", flexShrink: 0 }}
              />
            </div>
            {!isCollapsed && (
              <div className="branch-section-body">
                <InlineStepList
                  steps={el.steps}
                  parentLabel="ELSE"
                  allSteps={allSteps}
                  tables={tables}
                  screens={screens}
                  commonGroups={commonGroups}
                  onChange={(newSteps) =>
                    onChange({ elseBranch: { ...el, steps: newSteps } })
                  }
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
        );
      })()}

      {!readOnly && <div className="branch-add-row">
        <button className="branch-add-btn" onClick={addBranch}>
          <i className="bi bi-plus" /> 分岐を追加
        </button>
        {!step.elseBranch && (
          <button className="branch-add-btn" onClick={addElseBranch} style={{ flex: "0 0 auto" }}>
            <i className="bi bi-plus" /> ELSE分岐
          </button>
        )}
      </div>}
    </div>
  );
}
