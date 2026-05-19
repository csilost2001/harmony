// @ts-nocheck -- StepCard still spans legacy/v3 process-flow unions; tracked by #1016.
import { useState } from "react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
// #1186 Phase 2-B: types/action → types/v3 + processFlowMetadata 移行
import type {
  ProcessFlow,
  Step,
  StepKind as StepType,
} from "../../types/v3";
import {
  STEP_TYPE_LABELS,
  STEP_TYPE_ICONS,
  STEP_TYPE_COLORS,
  WORKFLOW_PATTERN_LABELS,
} from "../../utils/processFlowMetadata";
import type { ValidationError } from "../../utils/actionValidation";
import { getBindingName, getBindingOperation } from "../../utils/outputBinding";
import { generateUUID } from "../../utils/uuid";
import { createDefaultStep } from "../../store/processFlowStore";
import { MaturityBadge } from "./MaturityBadge";
import { NotesPanel } from "./NotesPanel";
import { StepAdvancedMetadataPanel } from "./StepAdvancedMetadataPanel";
import { AutoResizeTextarea } from "./internal/AutoResizeTextarea";
import { ALL_SUB_STEP_TYPES } from "./internal/stepCardConstants";
import { stepSummaryText } from "./internal/stepSummaryText";
import {
  AiAgentStepCardBody,
  AiCallStepCardBody,
  AuditStepCardBody,
  BranchStepCardBody,
  CommonProcessStepCardBody,
  ComponentCallStepCardBody,
  ComputeStepCardBody,
  DbAccessStepCardBody,
  DisplayUpdateStepCardBody,
  ExternalSystemStepCardBody,
  JumpStepCardBody,
  LogStepCardBody,
  LoopStepCardBody,
  ReturnStepCardBody,
  ScreenTransitionStepCardBody,
  TransactionScopeStepCardBody,
  ValidationStepCardBody,
  WorkflowStepCardBody,
} from "./internal/step-cards";

// ─── StepCard ────────────────────────────────────────────────────────────────

interface StepCardProps {
  step: Step;
  index: number;
  label: string;
  allSteps: Step[];
  tables: { id: string; physicalName: string; name: string }[];
  screens: { id: string; name: string }[];
  commonGroups: { id: string; name: string }[];
  conventions?: import("../../schemas/conventionsValidator").ConventionsCatalog | null;
  /** TX スコープ等で context.catalogs.errors を参照するために必要 (#415) */
  group?: ProcessFlow | null;
  onChange: (changes: Partial<Step>) => void;
  onCommit?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onAddSubStep: (type: StepType) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onNavigateCommon: (refId: string) => void;
  defaultExpanded?: boolean;
  dragHandleListeners?: DraggableSyntheticListeners;
  dragHandleAttributes?: DraggableAttributes;
  selected?: boolean;
  onHeaderClick?: (e: React.MouseEvent) => void;
  onIndent?: () => void;
  onOutdent?: () => void;
  onOutdentSubStep?: (subStepId: string) => void;
  depth?: number;
  validationErrors?: ValidationError[];
  /** この step を対象に AI マーカーを起票 (#261)。body は UI 側で prompt で取る */
  onAddMarker?: (body: string, kind?: "todo" | "question" | "attention" | "chat") => void;
  /** この step に紐付いた未解決マーカー数 (#261 badge 表示用) */
  markerCount?: number;
  /** この step の未解決 marker tooltip 本文 */
  markerTooltip?: string;
  /** kind 別未解決件数 (#261 色分け badge 表示用、省略時は markerCount のみ表示) */
  markerKinds?: { todo: number; question: number; attention: number; chat: number };
  /** #1076 編集レベル (rough / detail / implementation)。デフォルトは implementation (全項目) */
  editLevel?: "rough" | "detail" | "implementation";
  /** #1076 AI 依頼ボタン押下時のコールバック */
  onAskAi?: () => void;
  readOnly?: boolean;
}

export function StepCard({
  step,
  index,
  label,
  allSteps,
  tables,
  screens,
  commonGroups,
  conventions,
  group,
  onChange,
  onCommit,
  onMoveUp,
  onMoveDown,
  onDelete,
  onDuplicate,
  onAddSubStep,
  onContextMenu,
  onNavigateCommon,
  defaultExpanded,
  dragHandleListeners,
  dragHandleAttributes,
  selected,
  onHeaderClick,
  onIndent,
  onOutdent,
  onOutdentSubStep,
  depth = 0,
  validationErrors = [],
  onAddMarker,
  markerCount = 0,
  markerTooltip,
  markerKinds,
  editLevel = "implementation",
  onAskAi,
  readOnly = false,
}: StepCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSubTypePicker, setShowSubTypePicker] = useState(false);
  // 旧 collapsedBranchIds / loopBodyCollapsed は branch / loop body sub-component 内に
  // 内部化済 (Phase-2 #1145)。state lift する必要がある場合は本 component に戻す。

  const color = STEP_TYPE_COLORS[step.kind];
  const subSteps = step.subSteps ?? [];
  const myErrors = validationErrors.filter((e) => e.stepId === step.id);
  const hasError = myErrors.some((e) => e.severity === "error");
  const hasWarning = myErrors.some((e) => e.severity === "warning");

  // ── サブステップ管理 ────────────────────────────────────────────────────────

  const handleSubAddSubStep = (parentSubIdx: number, type: StepType) => {
    const newSub = createDefaultStep(type);
    const arr = subSteps.slice();
    arr[parentSubIdx] = {
      ...arr[parentSubIdx],
      subSteps: [...(arr[parentSubIdx].subSteps ?? []), newSub],
    };
    onChange({ subSteps: arr });
    onCommit?.();
  };

  const handleOutdentFromSubSteps = (parentSubId: string, stepToOutdentId: string) => {
    const arr = subSteps.slice();
    const parentIdx = arr.findIndex((s) => s.id === parentSubId);
    if (parentIdx < 0) return;
    const parent = { ...arr[parentIdx] };
    const outIdx = (parent.subSteps ?? []).findIndex((s) => s.id === stepToOutdentId);
    if (outIdx < 0) return;
    const outStep = parent.subSteps![outIdx];
    parent.subSteps = parent.subSteps!.filter((s) => s.id !== stepToOutdentId);
    arr[parentIdx] = parent;
    arr.splice(parentIdx + 1, 0, outStep);
    onChange({ subSteps: arr });
    onCommit?.();
  };

  // 旧 toggleBranchCollapse / setBranchAt / moveBranchUp/Down / deleteBranch /
  // addBranch / addElseBranch は BranchStepCardBody (Phase-2 #1145) に移管済。

  // ────────────────────────────────────────────────────────────────────────────

  const cardClass = [
    "step-card",
    selected ? "selected" : "",
    hasError ? "has-error" : "",
    hasWarning && !hasError ? "has-warning" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className="step-card-wrapper" data-edit-level={editLevel}>
      <div
        className={cardClass}
        data-step-id={step.id}
        data-edit-level={editLevel}
        style={{ borderLeftColor: color }}
        onContextMenu={onContextMenu}
      >
        <div
          className="step-card-header"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("[data-drag-handle]")) return;
            if ((e.ctrlKey || e.metaKey || e.shiftKey) && onHeaderClick) {
              onHeaderClick(e);
            } else {
              if (onHeaderClick) onHeaderClick(e);
              setExpanded(!expanded);
            }
          }}
        >
          {!readOnly && (dragHandleListeners || dragHandleAttributes) && (
            <span
              className="step-card-drag-handle"
              title="ドラッグで移動"
              data-drag-handle
              {...dragHandleAttributes}
              {...dragHandleListeners}
            >
              <i className="bi bi-grip-vertical" />
            </span>
          )}
          <span className="step-card-number">{label}</span>
          <i className={`step-card-icon ${STEP_TYPE_ICONS[step.kind]}`} style={{ color }} />
          <span className="step-card-type-label">{STEP_TYPE_LABELS[step.kind]}</span>
          <MaturityBadge
            maturity={step.maturity}
            onChange={(next) => onChange({ maturity: next } as Partial<Step>)}
          />
          {step.notes && step.notes.length > 0 && (
            <span
              className="step-notes-count-badge"
              title={`付箋 ${step.notes.length} 件`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 2,
                padding: "0 4px",
                color: "#64748b",
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              <i className="bi bi-sticky" />
              {step.notes.length}
            </span>
          )}
          {markerCount > 0 && (
            markerKinds ? (
              <span
                className="step-marker-badges"
                title={markerTooltip ?? `AI 依頼マーカー ${markerCount} 件`}
              >
                {markerKinds.todo > 0 && (
                  <span className="step-marker-chip kind-todo" title={`AI 依頼 (TODO) ${markerKinds.todo} 件`}>
                    <i className="bi bi-robot" />{markerKinds.todo}
                  </span>
                )}
                {markerKinds.question > 0 && (
                  <span className="step-marker-chip kind-question" title={`質問 ${markerKinds.question} 件`}>
                    <i className="bi bi-question-circle-fill" />{markerKinds.question}
                  </span>
                )}
                {markerKinds.attention > 0 && (
                  <span className="step-marker-chip kind-attention" title={`注意 ${markerKinds.attention} 件`}>
                    <i className="bi bi-exclamation-triangle-fill" />{markerKinds.attention}
                  </span>
                )}
                {markerKinds.chat > 0 && (
                  <span className="step-marker-chip kind-chat" title={`メモ ${markerKinds.chat} 件`}>
                    <i className="bi bi-chat-dots-fill" />{markerKinds.chat}
                  </span>
                )}
              </span>
            ) : (
              <span
                className="step-marker-badge"
                title={markerTooltip ?? `AI 依頼マーカー ${markerCount} 件`}
              >
                <i className="bi bi-megaphone-fill" />
                {markerCount}
              </span>
            )
          )}
          {step.runIf && (
            <button
              type="button"
              className="btn btn-link p-0"
              title={`runIf: ${step.runIf} (クリックで編集)`}
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              style={{ color: "#3b82f6", fontSize: 11, flexShrink: 0, lineHeight: 1 }}
            >
              <i className="bi bi-funnel" />
            </button>
          )}
          {step.txBoundary && (
            <button
              type="button"
              className="btn btn-link p-0"
              title={`TX: ${step.txBoundary.role} (${step.txBoundary.txId}) (クリックで編集)`}
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              style={{ color: "#8b5cf6", fontSize: 11, flexShrink: 0, lineHeight: 1 }}
            >
              <i className="bi bi-layers" />
            </button>
          )}
          {step.compensatesFor && (
            <button
              type="button"
              className="btn btn-link p-0"
              title={`Saga 補償 → ${step.compensatesFor} (クリックで編集)`}
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              style={{ color: "#ef4444", fontSize: 11, flexShrink: 0, lineHeight: 1 }}
            >
              <i className="bi bi-arrow-counterclockwise" />
            </button>
          )}
          {step.externalChain && (
            <button
              type="button"
              className="btn btn-link p-0"
              title={`chain: ${step.externalChain.chainId} (${step.externalChain.phase}) (クリックで編集)`}
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              style={{ color: "#f97316", fontSize: 11, flexShrink: 0, lineHeight: 1 }}
            >
              <i className="bi bi-link-45deg" />
            </button>
          )}
          {step.kind === "dbAccess" && step.affectedRowsCheck && (
            <button
              type="button"
              className="btn btn-link p-0"
              title={`行数チェック: ${step.affectedRowsCheck.operator}${step.affectedRowsCheck.expected} → ${step.affectedRowsCheck.onViolation} (クリックで編集)`}
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              style={{ color: "#14b8a6", fontSize: 11, flexShrink: 0, lineHeight: 1 }}
            >
              <i className="bi bi-shield-check" />
            </button>
          )}
          {step.kind === "externalSystem" && step.outcomes && Object.keys(step.outcomes).length > 0 && (
            <button
              type="button"
              className="btn btn-link p-0"
              title={`outcomes: ${Object.keys(step.outcomes).join(", ")} (クリックで編集)`}
              onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
              style={{ color: "#0ea5e9", fontSize: 11, flexShrink: 0, lineHeight: 1 }}
            >
              <i className="bi bi-diagram-3" />
            </button>
          )}
          {step.kind === "externalSystem" && step.fireAndForget && (
            <span title="fire-and-forget" style={{ color: "#eab308", fontSize: 11, flexShrink: 0 }}>
              <i className="bi bi-fire" />
            </span>
          )}
          {step.kind === "workflow" && (
            <span
              className="badge"
              title={step.pattern}
              style={{
                background: "#ccfbf1",
                color: "#0f766e",
                fontSize: 11,
                flexShrink: 0,
              }}
            >
              {WORKFLOW_PATTERN_LABELS[step.pattern]} / {step.approvers.length}件
            </span>
          )}
          <span className="step-card-description">{stepSummaryText(step, allSteps)}</span>
          {step.kind === "commonProcess" && step.refId && (
            <button
              className="btn btn-link btn-sm p-0 text-success"
              onClick={(e) => { e.stopPropagation(); onNavigateCommon(step.refId); }}
              title="共通処理の定義を開く"
            >
              <i className="bi bi-box-arrow-up-right" />
            </button>
          )}
          {onAskAi && (
            <button
              type="button"
              className="step-card-ai-btn"
              title="AI に依頼 (AI 依頼パネルに追加)"
              onClick={(e) => { e.stopPropagation(); onAskAi(); }}
            >
              <i className="bi bi-robot" />
            </button>
          )}
          {!readOnly && <div className="d-flex gap-1 ms-auto" style={{ flexShrink: 0 }}>
            {onOutdent && (
              <button className="step-card-menu-btn" onClick={(e) => { e.stopPropagation(); onOutdent(); }} title="上位レベルに移動（アウトデント）">
                <i className="bi bi-chevron-left" />
              </button>
            )}
            {onIndent && (
              <button className="step-card-menu-btn" onClick={(e) => { e.stopPropagation(); onIndent(); }} title="前のステップのサブステップに移動（インデント）">
                <i className="bi bi-chevron-right" />
              </button>
            )}
            {onMoveUp && (
              <button className="step-card-menu-btn" onClick={(e) => { e.stopPropagation(); onMoveUp(); }} title="上に移動">
                <i className="bi bi-chevron-up" />
              </button>
            )}
            {onMoveDown && (
              <button className="step-card-menu-btn" onClick={(e) => { e.stopPropagation(); onMoveDown(); }} title="下に移動">
                <i className="bi bi-chevron-down" />
              </button>
            )}
            <div style={{ position: "relative" }}>
              <button
                className="step-card-menu-btn"
                onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); setShowSubTypePicker(false); }}
              >
                <i className="bi bi-three-dots" />
              </button>
              {showMenu && (
                <div
                  className="step-context-menu"
                  style={{ top: "100%", right: 0, position: "absolute" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {!showSubTypePicker ? (
                    <>
                      <button className="step-context-menu-item" onClick={() => { onDuplicate(); setShowMenu(false); }}>
                        <i className="bi bi-copy" /> 複製
                      </button>
                      <button className="step-context-menu-item" onClick={() => setShowSubTypePicker(true)}>
                        <i className="bi bi-diagram-2" /> サブステップ追加 ▶
                      </button>
                      {onAddMarker && (
                        <button
                          className="step-context-menu-item"
                          onClick={() => {
                            setShowMenu(false);
                            const body = window.prompt(`このステップに AI への指摘を入力:\n(例: 並行制御の affectedRowsCheck を追加して)`);
                            if (body && body.trim()) onAddMarker(body.trim(), "todo");
                          }}
                        >
                          <i className="bi bi-robot" /> AI に指摘
                        </button>
                      )}
                      <div className="step-context-menu-sep" />
                      <button className="step-context-menu-item danger" onClick={() => { onDelete(); setShowMenu(false); }}>
                        <i className="bi bi-trash" /> 削除
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="step-context-menu-item" onClick={() => setShowSubTypePicker(false)}>
                        <i className="bi bi-arrow-left" /> 戻る
                      </button>
                      <div className="step-context-menu-sep" />
                      {ALL_SUB_STEP_TYPES.map((t) => (
                        <button
                          key={t}
                          className="step-context-menu-item"
                          onClick={() => { onAddSubStep(t); setShowMenu(false); setShowSubTypePicker(false); }}
                        >
                          <i className={`bi ${STEP_TYPE_ICONS[t]}`} style={{ color: STEP_TYPE_COLORS[t] }} />
                          {" "}{STEP_TYPE_LABELS[t]}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>}
        </div>

        {/* バリデーションメッセージ */}
        {myErrors.map((e, i) => (
          <div key={i} className={`step-validation-msg ${e.severity}`}>
            <i className={`bi ${e.severity === "error" ? "bi-x-circle-fill" : "bi-exclamation-triangle-fill"}`} />
            {e.message}
          </div>
        ))}

        {/* 展開時: 編集フォーム */}
        {expanded && (
          <div className="step-card-body">
            <div className="row g-2 mb-2">
              <div className="col-12">
                <label className="form-label">処理概要</label>
                <AutoResizeTextarea
                  value={step.description}
                  onChange={(e) => onChange({ description: e.target.value })}
                  onBlur={onCommit}
                  placeholder="処理の説明"
                />
              </div>
            </div>
            <div className="row g-2 mb-2 step-card-section" data-field-path="runIf" data-level-min="detail">
              <div className="col-12">
                <label className="form-label small">
                  <i className="bi bi-funnel me-1" />
                  条件実行 (runIf)
                  <span className="text-muted ms-1" style={{ fontSize: "0.75rem" }}>
                    — 真偽式、偽なら本ステップを skip
                  </span>
                </label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={step.runIf ?? ""}
                  onChange={(e) => onChange({ runIf: e.target.value || undefined } as Partial<Step>)}
                  onBlur={onCommit}
                  placeholder="例: @paymentMethod == 'credit_card'"
                />
              </div>
            </div>
            <div className="row g-2 mb-2">
              <div className="col-8">
                <label className="form-label small">
                  <i className="bi bi-box-arrow-right me-1" />
                  結果変数名 (outputBinding)
                </label>
                <input
                  type="text"
                  className="form-control form-control-sm"
                  value={getBindingName(step.outputBinding) ?? ""}
                  onChange={(e) => {
                    const name = e.target.value;
                    const op = getBindingOperation(step.outputBinding);
                    if (!name) {
                      onChange({ outputBinding: undefined } as Partial<Step>);
                    } else if (op === "assign") {
                      onChange({ outputBinding: name } as Partial<Step>);
                    } else {
                      onChange({ outputBinding: { name, operation: op } } as Partial<Step>);
                    }
                  }}
                  onBlur={onCommit}
                  placeholder="例: duplicateCustomer / subtotal / enrichedItems"
                />
              </div>
              <div className="col-4">
                <label className="form-label small">代入方式</label>
                <select
                  className="form-select form-select-sm"
                  value={getBindingOperation(step.outputBinding)}
                  onChange={(e) => {
                    const name = getBindingName(step.outputBinding);
                    const op = e.target.value as "assign" | "accumulate" | "push";
                    if (!name) {
                      // 名前未入力時は代入方式だけ先に決めても undefined 維持 (空の binding を作らない)
                      return;
                    }
                    if (op === "assign") {
                      onChange({ outputBinding: name } as Partial<Step>);
                    } else {
                      onChange({ outputBinding: { name, operation: op } } as Partial<Step>);
                    }
                  }}
                >
                  <option value="assign">assign (代入)</option>
                  <option value="accumulate">accumulate (累積)</option>
                  <option value="push">push (追加)</option>
                </select>
              </div>
            </div>
            <div className="step-card-section" data-level-min="implementation">
              <StepAdvancedMetadataPanel
                step={step}
                onChange={onChange}
                onCommit={onCommit}
              />
            </div>
            <NotesPanel
              notes={step.notes}
              onChange={(notes) => onChange({ notes } as Partial<Step>)}
            />

            {/* ── ステップ種別別詳細 (detail 以上で表示) ─────── */}
            {/*
             * Phase-2 (#1145) で 15 種の kind body を sub-component に分離。
             * dispatch 順は元の StepCard.tsx と同一。
             */}
            <div className="step-card-section" data-level-min="detail">
              {step.kind === "validation" && (
                <ValidationStepCardBody
                  step={step}
                  allSteps={allSteps}
                  onChange={onChange}
                  onCommit={onCommit}
                  conventions={conventions}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "dbAccess" && (
                <DbAccessStepCardBody
                  step={step}
                  allSteps={allSteps}
                  tables={tables}
                  onChange={onChange}
                  onCommit={onCommit}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "externalSystem" && (
                <ExternalSystemStepCardBody
                  step={step}
                  allSteps={allSteps}
                  onChange={onChange}
                  onCommit={onCommit}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "commonProcess" && (
                <CommonProcessStepCardBody
                  step={step}
                  allSteps={allSteps}
                  commonGroups={commonGroups}
                  onChange={onChange}
                  onCommit={onCommit}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "compute" && (
                <ComputeStepCardBody
                  step={step}
                  allSteps={allSteps}
                  onChange={onChange}
                  onCommit={onCommit}
                  conventions={conventions}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "return" && (
                <ReturnStepCardBody
                  step={step}
                  allSteps={allSteps}
                  onChange={onChange}
                  onCommit={onCommit}
                  conventions={conventions}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "screenTransition" && (
                <ScreenTransitionStepCardBody
                  step={step}
                  allSteps={allSteps}
                  screens={screens}
                  onChange={onChange}
                  onCommit={onCommit}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "displayUpdate" && (
                <DisplayUpdateStepCardBody
                  step={step}
                  allSteps={allSteps}
                  onChange={onChange}
                  onCommit={onCommit}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "branch" && (
                <BranchStepCardBody
                  step={step}
                  allSteps={allSteps}
                  tables={tables}
                  screens={screens}
                  commonGroups={commonGroups}
                  validationErrors={validationErrors}
                  conventions={conventions}
                  group={group}
                  onChange={onChange}
                  onCommit={onCommit}
                  onNavigateCommon={onNavigateCommon}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "loop" && (
                <LoopStepCardBody
                  step={step}
                  allSteps={allSteps}
                  tables={tables}
                  screens={screens}
                  commonGroups={commonGroups}
                  validationErrors={validationErrors}
                  conventions={conventions}
                  group={group}
                  onChange={onChange}
                  onCommit={onCommit}
                  onNavigateCommon={onNavigateCommon}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "log" && (
                <LogStepCardBody
                  step={step}
                  allSteps={allSteps}
                  onChange={onChange}
                  onCommit={onCommit}
                  conventions={conventions}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "audit" && (
                <AuditStepCardBody
                  step={step}
                  allSteps={allSteps}
                  onChange={onChange}
                  onCommit={onCommit}
                  conventions={conventions}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "transactionScope" && (
                <TransactionScopeStepCardBody
                  step={step}
                  allSteps={allSteps}
                  tables={tables}
                  screens={screens}
                  commonGroups={commonGroups}
                  validationErrors={validationErrors}
                  conventions={conventions}
                  group={group}
                  onChange={onChange}
                  onCommit={onCommit}
                  onNavigateCommon={onNavigateCommon}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "jump" && (
                <JumpStepCardBody
                  step={step}
                  allSteps={allSteps}
                  onChange={onChange}
                  onCommit={onCommit}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "workflow" && (
                <WorkflowStepCardBody
                  step={step}
                  allSteps={allSteps}
                  tables={tables}
                  screens={screens}
                  commonGroups={commonGroups}
                  validationErrors={validationErrors}
                  conventions={conventions}
                  group={group}
                  onChange={onChange}
                  onCommit={onCommit}
                  onNavigateCommon={onNavigateCommon}
                  readOnly={readOnly}
                />
              )}

              {/* Phase-3 (#1145、#1163 review Phase-2 補足) 追加 3 dispatch */}
              {step.kind === "componentCall" && (
                <ComponentCallStepCardBody
                  step={step}
                  allSteps={allSteps}
                  onChange={onChange}
                  onCommit={onCommit}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "aiCall" && (
                <AiCallStepCardBody
                  step={step}
                  allSteps={allSteps}
                  onChange={onChange}
                  onCommit={onCommit}
                  readOnly={readOnly}
                />
              )}

              {step.kind === "aiAgent" && (
                <AiAgentStepCardBody
                  step={step}
                  allSteps={allSteps}
                  onChange={onChange}
                  onCommit={onCommit}
                  readOnly={readOnly}
                />
              )}
            </div>{/* end step-card-section data-level-min="detail" */}

            <div className="row g-2">
              <div className="col-12">
                <label className="form-label">メモ</label>
                <AutoResizeTextarea
                  value={step.note ?? ""}
                  onChange={(e) => onChange({ note: e.target.value })}
                  onBlur={onCommit}
                  placeholder="補足情報"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* サブステップ（再帰レンダリング） */}
      {subSteps.length > 0 && (
        <div className="sub-steps">
          {subSteps.map((sub, si) => (
            <div key={sub.id} className="mb-1">
              <StepCard
                step={sub}
                index={si}
                label={`${index + 1}-${si + 1}`}
                allSteps={allSteps}
                tables={tables}
                screens={screens}
                commonGroups={commonGroups}
                onChange={(changes) => {
                  const arr = subSteps.slice();
                  const idx = arr.findIndex((s) => s.id === sub.id);
                  if (idx >= 0) {
                    arr[idx] = { ...arr[idx], ...changes } as Step;
                    onChange({ subSteps: arr });
                  }
                }}
                onCommit={onCommit}
                onMoveUp={si > 0 ? () => {
                  const arr = subSteps.slice();
                  [arr[si - 1], arr[si]] = [arr[si], arr[si - 1]];
                  onChange({ subSteps: arr });
                  onCommit?.();
                } : undefined}
                onMoveDown={si < subSteps.length - 1 ? () => {
                  const arr = subSteps.slice();
                  [arr[si], arr[si + 1]] = [arr[si + 1], arr[si]];
                  onChange({ subSteps: arr });
                  onCommit?.();
                } : undefined}
                onDelete={() => {
                  onChange({ subSteps: subSteps.filter((s) => s.id !== sub.id) });
                  onCommit?.();
                }}
                onDuplicate={() => {
                  const clone = JSON.parse(JSON.stringify(sub)) as Step;
                  clone.id = generateUUID();
                  const arr = subSteps.slice();
                  arr.splice(si + 1, 0, clone);
                  onChange({ subSteps: arr });
                  onCommit?.();
                }}
                onAddSubStep={(type) => handleSubAddSubStep(si, type)}
                onContextMenu={(e) => e.preventDefault()}
                onNavigateCommon={onNavigateCommon}
                depth={depth + 1}
                onOutdent={onOutdentSubStep ? () => onOutdentSubStep(sub.id) : undefined}
                onOutdentSubStep={(subSubId) => handleOutdentFromSubSteps(sub.id, subSubId)}
                validationErrors={validationErrors}
                conventions={conventions}
                group={group}
                editLevel={editLevel}
                onAskAi={onAskAi}
                readOnly={readOnly}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
