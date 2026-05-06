// @ts-nocheck
import { useState, useRef, useEffect } from "react";
import type { DraggableAttributes, DraggableSyntheticListeners } from "@dnd-kit/core";
import type {
  Branch,
  ProcessFlow,
  Step,
  StepType,
  DbOperation,
  LoopKind,
  LoopConditionMode,
} from "../../types/action";
import {
  STEP_TYPE_LABELS,
  STEP_TYPE_ICONS,
  STEP_TYPE_COLORS,
  DB_OPERATION_LABELS,
  WORKFLOW_PATTERN_LABELS,
} from "../../types/action";
import { resolveJumpLabel } from "../../utils/actionUtils";
import type { ValidationError } from "../../utils/actionValidation";
import { getBranchConditionText } from "../../utils/branchCondition";
import { getBindingName, getBindingOperation } from "../../utils/outputBinding";
import { generateUUID } from "../../utils/uuid";
import { createDefaultStep } from "../../store/processFlowStore";
import { MaturityBadge } from "./MaturityBadge";
import { NotesPanel } from "./NotesPanel";
import { StepAdvancedMetadataPanel } from "./StepAdvancedMetadataPanel";
import { ValidationRulesPanel } from "./ValidationRulesPanel";
import { ConvCompletionInput } from "../common/ConvCompletionInput";
import { ExternalOutcomesPanel } from "./ExternalOutcomesPanel";
import { JumpTargetSelector } from "./JumpTargetSelector";
import { WorkflowStepPanel } from "./WorkflowStepPanel";
import { LogStepPanel } from "./LogStepPanel";
import { AuditStepPanel } from "./AuditStepPanel";
import { TransactionScopeStepPanel } from "./TransactionScopeStepPanel";

const ALL_SUB_STEP_TYPES: StepType[] = [
  "validation", "dbAccess", "externalSystem", "commonProcess",
  "screenTransition", "displayUpdate", "branch", "loop",
  "loopBreak", "loopContinue", "jump", "compute", "return", "other",
  "log", "audit", "workflow", "transactionScope",
  "eventPublish", "eventSubscribe", "closing", "cdc",
];

// ─── ヘルパーコンポーネント ──────────────────────────────────────────────────

function AutoResizeTextarea({
  value, onChange, onBlur, placeholder, className,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      className={className ?? "form-control form-control-sm auto-resize"}
      value={value}
      rows={1}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
    />
  );
}

// ─── インラインステップリスト ─────────────────────────────────────────────────
// branch.steps / loop.steps の再帰レンダリング用。
// function 宣言（ホイスティング）で定義することで StepCard との相互参照を実現。

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
  conventions?: import("../../schemas/conventionsValidator").ConventionsCatalog | null;
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
}

const DB_OPS: DbOperation[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];
const trimToUndefined = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

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
}: StepCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const [showMenu, setShowMenu] = useState(false);
  const [showSubTypePicker, setShowSubTypePicker] = useState(false);
  const [collapsedBranchIds, setCollapsedBranchIds] = useState<Set<string>>(new Set());
  const [loopBodyCollapsed, setLoopBodyCollapsed] = useState(false);

  const color = STEP_TYPE_COLORS[step.kind];
  const subSteps = step.subSteps ?? [];
  const myErrors = validationErrors.filter((e) => e.stepId === step.id);
  const hasError = myErrors.some((e) => e.severity === "error");
  const hasWarning = myErrors.some((e) => e.severity === "warning");

  const summaryText = (): string => {
    switch (step.kind) {
      case "validation":
        return step.conditions || step.description || "バリデーション";
      case "dbAccess":
        return `${step.tableId || "?"} ${DB_OPERATION_LABELS[step.operation] ?? step.operation}${step.description ? ` - ${step.description}` : ""}`;
      case "externalSystem":
        return `${step.systemRef || "?"}${step.protocol ? ` (${step.protocol})` : ""}${step.description ? ` - ${step.description}` : ""}`;
      case "commonProcess":
        return step.refId || step.description || "共通処理";
      case "screenTransition":
        return `${step.targetScreenId || "?"}${step.description ? ` - ${step.description}` : ""}`;
      case "displayUpdate":
        return step.target || step.description || "表示更新";
      case "branch":
        return step.description || getBranchConditionText(step.branches[0]?.condition) || "条件分岐";
      case "loop":
        if (step.loopKind === "count") return step.countExpression || step.description || "ループ";
        if (step.loopKind === "condition") return step.conditionExpression || step.description || "ループ";
        return `${step.collectionSource || "コレクション"}${step.collectionItemName ? ` [${step.collectionItemName}]` : ""}`;
      case "loopBreak":
        return step.description || "ループ終了";
      case "loopContinue":
        return step.description || "次のループへ";
      case "jump": {
        const jumpLabel = resolveJumpLabel(step.jumpTo, allSteps);
        return `[${jumpLabel}] へ${step.description ? ` - ${step.description}` : ""}`;
      }
      case "workflow":
        return `${WORKFLOW_PATTERN_LABELS[step.pattern]} / 承認者 ${step.approvers.length}件${step.description ? ` - ${step.description}` : ""}`;
      case "transactionScope": {
        const n = step.steps.length;
        const iso = step.isolationLevel ?? "READ_COMMITTED";
        return `TX (${iso}, ${n} ステップ)${step.description ? ` - ${step.description}` : ""}`;
      }
      default:
        return step.description || "その他";
    }
  };

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

  // ── 分岐管理 (Phase 3) ──────────────────────────────────────────────────────

  const toggleBranchCollapse = (branchId: string) => {
    setCollapsedBranchIds((prev) => {
      const next = new Set(prev);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  };

  const setBranchAt = (idx: number, next: Branch) => {
    if (step.kind !== "branch") return;
    const branches = step.branches.slice();
    branches[idx] = next;
    onChange({ branches } as Partial<Step>);
  };

  const moveBranchUp = (idx: number) => {
    if (step.kind !== "branch" || idx <= 0) return;
    const branches = step.branches.map((b) => ({ ...b }));
    [branches[idx - 1], branches[idx]] = [branches[idx], branches[idx - 1]];
    branches.forEach((b, i) => { b.code = String.fromCharCode(65 + i); });
    onChange({ branches } as Partial<Step>);
    onCommit?.();
  };

  const moveBranchDown = (idx: number) => {
    if (step.kind !== "branch") return;
    const branches = step.branches.map((b) => ({ ...b }));
    if (idx >= branches.length - 1) return;
    [branches[idx], branches[idx + 1]] = [branches[idx + 1], branches[idx]];
    branches.forEach((b, i) => { b.code = String.fromCharCode(65 + i); });
    onChange({ branches } as Partial<Step>);
    onCommit?.();
  };

  const deleteBranch = (idx: number) => {
    if (step.kind !== "branch" || step.branches.length <= 1) return;
    const branches = step.branches.filter((_, i) => i !== idx).map((b, i) => ({
      ...b,
      code: String.fromCharCode(65 + i),
    }));
    onChange({ branches } as Partial<Step>);
    onCommit?.();
  };

  const addBranch = () => {
    if (step.kind !== "branch") return;
    const code = String.fromCharCode(65 + step.branches.length);
    const newBranch: Branch = { id: generateUUID(), code, condition: "", steps: [] };
    onChange({ branches: [...step.branches, newBranch] } as Partial<Step>);
    onCommit?.();
  };

  const addElseBranch = () => {
    if (step.kind !== "branch") return;
    const elseBranch: Branch = { id: generateUUID(), code: "ELSE", condition: "", steps: [] };
    onChange({ elseBranch } as Partial<Step>);
    onCommit?.();
  };

  // ────────────────────────────────────────────────────────────────────────────

  const cardClass = [
    "step-card",
    selected ? "selected" : "",
    hasError ? "has-error" : "",
    hasWarning && !hasError ? "has-warning" : "",
  ].filter(Boolean).join(" ");

  return (
    <div>
      <div
        className={cardClass}
        data-step-id={step.id}
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
          {(dragHandleListeners || dragHandleAttributes) && (
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
          <span className="step-card-description">{summaryText()}</span>
          {step.kind === "commonProcess" && step.refId && (
            <button
              className="btn btn-link btn-sm p-0 text-success"
              onClick={(e) => { e.stopPropagation(); onNavigateCommon(step.refId); }}
              title="共通処理の定義を開く"
            >
              <i className="bi bi-box-arrow-up-right" />
            </button>
          )}
          <div className="d-flex gap-1 ms-auto" style={{ flexShrink: 0 }}>
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
          </div>
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
            <div className="row g-2 mb-2" data-field-path="runIf">
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
            <StepAdvancedMetadataPanel
              step={step}
              onChange={onChange}
              onCommit={onCommit}
            />
            <NotesPanel
              notes={step.notes}
              onChange={(notes) => onChange({ notes } as Partial<Step>)}
            />

            {/* ── バリデーション ───────────────────────────────── */}
            {step.kind === "validation" && (
              <>
                <div className="row g-2 mb-2" data-field-path="conditions">
                  <div className="col-12">
                    <label className="form-label">バリデーション条件 (自由記述)</label>
                    <input
                      className="form-control form-control-sm"
                      value={step.conditions}
                      onChange={(e) => onChange({ conditions: e.target.value } as Partial<Step>)}
                      onBlur={onCommit}
                      placeholder="必須チェック、形式チェック等 (rules[] で構造化済なら補足用)"
                    />
                  </div>
                </div>
                <ValidationRulesPanel
                  rules={step.rules}
                  onChange={(rules) => onChange({ rules } as Partial<Step>)}
                  conventions={conventions ?? null}
                />
                {step.inlineBranch && (
                  <div className="step-inline-branch">
                    <div className="step-branch-box ok">
                      <div className="step-branch-label">A: OK</div>
                      {typeof step.inlineBranch.ok === "string" ? (
                        <input
                          className="form-control form-control-sm"
                          value={step.inlineBranch.ok}
                          onChange={(e) =>
                            onChange({ inlineBranch: { ...step.inlineBranch!, ok: e.target.value } } as Partial<Step>)
                          }
                          placeholder="OK時の処理"
                          onBlur={onCommit}
                        />
                      ) : (
                        <span className="form-control form-control-sm text-muted" style={{ cursor: "default" }}>
                          ステップ {step.inlineBranch.ok.length} 件 (JSON編集)
                        </span>
                      )}
                    </div>
                    <div className="step-branch-box ng">
                      <div className="step-branch-label">B: NG</div>
                      {typeof step.inlineBranch.ng === "string" ? (
                        <input
                          className="form-control form-control-sm"
                          value={step.inlineBranch.ng}
                          onChange={(e) =>
                            onChange({ inlineBranch: { ...step.inlineBranch!, ng: e.target.value } } as Partial<Step>)
                          }
                          placeholder="NG時の処理"
                          onBlur={onCommit}
                        />
                      ) : (
                        <span className="form-control form-control-sm text-muted" style={{ cursor: "default" }}>
                          ステップ {step.inlineBranch.ng.length} 件 (JSON編集)
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {step.inlineBranch && (
                  <div className="row g-2 mb-2 mt-1" style={{ fontSize: "0.8rem" }}>
                    <div className="col-5">
                      <label className="form-label small mb-0">
                        NG → responseRef
                      </label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={step.inlineBranch.ngResponseRef ?? ""}
                        onChange={(e) =>
                          onChange({
                            inlineBranch: {
                              ...step.inlineBranch!,
                              ngResponseRef: e.target.value || undefined,
                            },
                          } as Partial<Step>)
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
                              ngBodyExpression: e.target.value || undefined,
                            },
                          } as Partial<Step>)
                        }
                        onBlur={onCommit}
                        placeholder="例: { code: 'VALIDATION', fieldErrors: @fieldErrors }"
                        style={{ fontSize: "0.8rem", fontFamily: "monospace" }}
                      />
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ── DB操作 ──────────────────────────────────────── */}
            {step.kind === "dbAccess" && (
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
            )}

            {/* ── 外部システム ─────────────────────────────────── */}
            {step.kind === "externalSystem" && (
              <>
                <div className="form-row-pair">
                  <div className="form-group">
                    <label className="form-label">接続先</label>
                    <input
                      className="form-control form-control-sm"
                      value={step.systemRef ?? ""}
                      onChange={(e) => onChange({ systemRef: e.target.value } as Partial<Step>)}
                      onBlur={onCommit}
                      placeholder="システム名 (context.catalogs.externalSystems のキー)"
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">プロトコル</label>
                    <input
                      className="form-control form-control-sm"
                      value={step.protocol ?? ""}
                      onChange={(e) => onChange({ protocol: e.target.value } as Partial<Step>)}
                      onBlur={onCommit}
                      placeholder="REST / SOAP / gRPC"
                    />
                  </div>
                </div>
                <div className="row g-2 mb-2">
                  <div className="col-6" data-field-path="operationRef">
                    <label className="form-label">operationRef</label>
                    <input
                      className="form-control form-control-sm"
                      data-field-path="operationRef"
                      value={step.operationRef ?? ""}
                      onChange={(e) => onChange({ operationRef: trimToUndefined(e.target.value) } as Partial<Step>)}
                      onBlur={onCommit}
                      placeholder="/v1/payment_intents POST"
                      style={{ fontFamily: "monospace" }}
                    />
                  </div>
                  <div className="col-6" data-field-path="operationId">
                    <label className="form-label">operationId</label>
                    <input
                      className="form-control form-control-sm"
                      data-field-path="operationId"
                      value={step.operationId ?? ""}
                      onChange={(e) => onChange({ operationId: trimToUndefined(e.target.value) } as Partial<Step>)}
                      onBlur={onCommit}
                      placeholder="PostPaymentIntents"
                      style={{ fontFamily: "monospace" }}
                    />
                  </div>
                </div>
                <div className="row g-2 mb-2">
                  <div className="col-6" data-field-path="requestBodyRef">
                    <label className="form-label">requestBodyRef</label>
                    <input
                      className="form-control form-control-sm"
                      data-field-path="requestBodyRef"
                      value={step.requestBodyRef ?? ""}
                      onChange={(e) => onChange({ requestBodyRef: trimToUndefined(e.target.value) } as Partial<Step>)}
                      onBlur={onCommit}
                      placeholder="#/components/schemas/PaymentIntentCreateParams"
                      style={{ fontFamily: "monospace" }}
                    />
                  </div>
                  <div className="col-6" data-field-path="responseRef">
                    <label className="form-label">responseRef</label>
                    <input
                      className="form-control form-control-sm"
                      data-field-path="responseRef"
                      value={step.responseRef ?? ""}
                      onChange={(e) => onChange({ responseRef: trimToUndefined(e.target.value) } as Partial<Step>)}
                      onBlur={onCommit}
                      placeholder="#/components/responses/200/content/application~1json/schema"
                      style={{ fontFamily: "monospace" }}
                    />
                  </div>
                </div>
                <div className="row g-2 mb-2 align-items-center" style={{ fontSize: "0.85rem" }}>
                  <div className="col-auto">
                    <label className="form-label small mb-0">タイムアウト</label>
                  </div>
                  <div className="col-auto">
                    <input
                      type="number"
                      className="form-control form-control-sm"
                      value={step.timeoutMs ?? ""}
                      onChange={(e) => onChange({ timeoutMs: e.target.value ? Number(e.target.value) : undefined } as Partial<Step>)}
                      onBlur={onCommit}
                      placeholder="ms"
                      style={{ width: 90 }}
                    />
                  </div>
                  <div className="col-auto text-muted">ms</div>
                  <div className="col-auto">
                    <label className="form-check-label small">
                      <input
                        type="checkbox"
                        className="form-check-input me-1"
                        checked={!!step.fireAndForget}
                        onChange={(e) => onChange({ fireAndForget: e.target.checked || undefined } as Partial<Step>)}
                      />
                      fire-and-forget (同期レスポンス待たない)
                    </label>
                  </div>
                </div>
                <div className="row g-2 mb-2 align-items-center" style={{ fontSize: "0.8rem" }}>
                  <div className="col-auto">
                    <label className="form-label small mb-0">リトライ</label>
                  </div>
                  <div className="col-auto">
                    <input
                      type="number"
                      className="form-control form-control-sm"
                      value={step.retryPolicy?.maxAttempts ?? ""}
                      onChange={(e) => {
                        const n = e.target.value ? Number(e.target.value) : 0;
                        if (n <= 0) {
                          onChange({ retryPolicy: undefined } as Partial<Step>);
                        } else {
                          onChange({
                            retryPolicy: {
                              maxAttempts: n,
                              backoff: step.retryPolicy?.backoff,
                              initialDelayMs: step.retryPolicy?.initialDelayMs,
                            },
                          } as Partial<Step>);
                        }
                      }}
                      onBlur={onCommit}
                      placeholder="maxAttempts"
                      style={{ width: 90, fontSize: "0.8rem" }}
                    />
                  </div>
                  {step.retryPolicy && (
                    <>
                      <div className="col-auto">
                        <select
                          className="form-select form-select-sm"
                          value={step.retryPolicy.backoff ?? ""}
                          onChange={(e) => onChange({
                            retryPolicy: {
                              ...step.retryPolicy!,
                              backoff: e.target.value as "fixed" | "exponential" || undefined,
                            },
                          } as Partial<Step>)}
                          style={{ width: "auto", fontSize: "0.8rem" }}
                        >
                          <option value="">backoff: —</option>
                          <option value="fixed">fixed</option>
                          <option value="exponential">exponential</option>
                        </select>
                      </div>
                      <div className="col-auto">
                        <input
                          type="number"
                          className="form-control form-control-sm"
                          value={step.retryPolicy.initialDelayMs ?? ""}
                          onChange={(e) => onChange({
                            retryPolicy: {
                              ...step.retryPolicy!,
                              initialDelayMs: e.target.value ? Number(e.target.value) : undefined,
                            },
                          } as Partial<Step>)}
                          onBlur={onCommit}
                          placeholder="initialDelayMs"
                          style={{ width: 120, fontSize: "0.8rem" }}
                        />
                      </div>
                    </>
                  )}
                </div>
                <ExternalOutcomesPanel
                  step={step}
                  onChange={(patch) => onChange(patch as Partial<Step>)}
                  onCommit={onCommit}
                />
              </>
            )}

            {/* ── 共通処理 ─────────────────────────────────────── */}
            {step.kind === "commonProcess" && (
              <>
                <div className="row g-2 mb-2">
                  <div className="col-12">
                    <label className="form-label">共通処理</label>
                    <select
                      className="form-select form-select-sm"
                      value={step.refId}
                      onChange={(e) => {
                        const cg = commonGroups.find((g) => g.id === e.target.value);
                        onChange({ refId: e.target.value, refName: cg?.name ?? "" } as Partial<Step>);
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
                      } as Partial<Step>);
                    }}
                    onBlur={onCommit}
                    placeholder={"sessionId=@session.id\ntrustedLevel='high'"}
                    style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
                  />
                </div>
              </>
            )}

            {/* ── 計算ステップ (ComputeStep) ───────────────────── */}
            {step.kind === "compute" && (
              <div className="row g-2 mb-2" data-field-path="expression">
                <div className="col-12">
                  <label className="form-label">
                    <i className="bi bi-calculator me-1" />
                    代入式 (expression)
                  </label>
                  <ConvCompletionInput
                    className="form-control form-control-sm"
                    value={step.expression}
                    onValueChange={(v) => onChange({ expression: v } as Partial<Step>)}
                    onCommit={onCommit}
                    conventions={conventions ?? null}
                    placeholder="例: Math.floor(@subtotal * 0.10) / @subtotal + @taxAmount"
                    style={{ fontFamily: "monospace" }}
                  />
                </div>
              </div>
            )}

            {/* ── 返却ステップ (ReturnStep) ────────────────────── */}
            {step.kind === "return" && (
              <>
                <div className="row g-2 mb-2">
                  <div className="col-6">
                    <label className="form-label">
                      <i className="bi bi-reply me-1" />
                      responseRef (action.responses[].id)
                    </label>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={step.responseRef ?? ""}
                      onChange={(e) => onChange({ responseRef: e.target.value || undefined } as Partial<Step>)}
                      onBlur={onCommit}
                      placeholder="例: 409-stock-shortage"
                    />
                  </div>
                  <div className="col-6" data-field-path="bodyExpression">
                    <label className="form-label">bodyExpression</label>
                    <ConvCompletionInput
                      className="form-control form-control-sm"
                      value={step.bodyExpression ?? ""}
                      onValueChange={(v) => onChange({ bodyExpression: v || undefined } as Partial<Step>)}
                      onCommit={onCommit}
                      conventions={conventions ?? null}
                      placeholder="例: { code: 'STOCK_SHORTAGE', detail: @shortageList }"
                      style={{ fontFamily: "monospace" }}
                    />
                  </div>
                </div>
              </>
            )}

            {/* ── 画面遷移 ─────────────────────────────────────── */}
            {step.kind === "screenTransition" && (
              <div className="row g-2 mb-2">
                <div className="col-12">
                  <label className="form-label">遷移先画面</label>
                  <select
                    className="form-select form-select-sm"
                    value={step.targetScreenId ?? ""}
                    onChange={(e) => {
                      const s = screens.find((s) => s.id === e.target.value);
                      onChange({ targetScreenId: e.target.value, targetScreenName: s?.name ?? e.target.value } as Partial<Step>);
                    }}
                  >
                    <option value="">（選択または手入力）</option>
                    {screens.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <input
                    className="form-control form-control-sm mt-1"
                    value={step.targetScreenName}
                    onChange={(e) => onChange({ targetScreenName: e.target.value } as Partial<Step>)}
                    onBlur={onCommit}
                    placeholder="画面名を直接入力"
                  />
                </div>
              </div>
            )}

            {/* ── 表示更新 ─────────────────────────────────────── */}
            {step.kind === "displayUpdate" && (
              <div className="row g-2 mb-2">
                <div className="col-12">
                  <label className="form-label">更新対象</label>
                  <input
                    className="form-control form-control-sm"
                    value={step.target}
                    onChange={(e) => onChange({ target: e.target.value } as Partial<Step>)}
                    onBlur={onCommit}
                    placeholder="メッセージ表示、一覧テーブル更新 等"
                  />
                </div>
              </div>
            )}

            {/* ── 条件分岐 (Phase 3) ───────────────────────────── */}
            {step.kind === "branch" && (
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
                        {typeof br.condition === "object" ? (
                          <div className="d-flex align-items-center gap-1 flex-grow-1" onClick={(e) => e.stopPropagation()}>
                            <span className="badge bg-info text-dark" style={{ fontSize: "0.7rem" }}>tryCatch</span>
                            <input
                              className="form-control form-control-sm"
                              value={(br.condition as { kind: "tryCatch"; errorCode: string }).errorCode}
                              placeholder="errorCode (例: STOCK_SHORTAGE)"
                              onChange={(e) => setBranchAt(bi, {
                                ...br,
                                condition: { ...br.condition as { kind: "tryCatch"; errorCode: string; description?: string }, errorCode: e.target.value },
                              })}
                              onBlur={onCommit}
                            />
                            <button
                              type="button"
                              className="btn btn-sm btn-link text-muted p-0"
                              title="自由記述に戻す"
                              onClick={() => setBranchAt(bi, { ...br, condition: "" })}
                            >
                              <i className="bi bi-arrow-counterclockwise" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <input
                              className="form-control form-control-sm branch-condition-input"
                              value={br.condition}
                              placeholder="分岐条件 (自由記述)"
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) => setBranchAt(bi, { ...br, condition: e.target.value })}
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
                                  condition: { kind: "tryCatch", errorCode: "" },
                                });
                              }}
                              style={{ flexShrink: 0 }}
                            >
                              <i className="bi bi-shield-exclamation" />
                            </button>
                          </>
                        )}
                        {bi > 0 && (
                          <button
                            className="step-card-menu-btn"
                            title="上に移動"
                            onClick={(e) => { e.stopPropagation(); moveBranchUp(bi); }}
                          >
                            <i className="bi bi-chevron-up" />
                          </button>
                        )}
                        {bi < step.branches.length - 1 && (
                          <button
                            className="step-card-menu-btn"
                            title="下に移動"
                            onClick={(e) => { e.stopPropagation(); moveBranchDown(bi); }}
                          >
                            <i className="bi bi-chevron-down" />
                          </button>
                        )}
                        {step.branches.length > 1 && (
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
                        <button
                          className="step-card-menu-btn danger"
                          title="ELSE分岐を削除"
                          onClick={(e) => {
                            e.stopPropagation();
                            onChange({ elseBranch: undefined } as Partial<Step>);
                            onCommit?.();
                          }}
                        >
                          <i className="bi bi-trash" />
                        </button>
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
                              onChange({ elseBranch: { ...el, steps: newSteps } } as Partial<Step>)
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
                  );
                })()}

                <div className="branch-add-row">
                  <button className="branch-add-btn" onClick={addBranch}>
                    <i className="bi bi-plus" /> 分岐を追加
                  </button>
                  {!step.elseBranch && (
                    <button className="branch-add-btn" onClick={addElseBranch} style={{ flex: "0 0 auto" }}>
                      <i className="bi bi-plus" /> ELSE分岐
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── ループ (Phase 4) ─────────────────────────────── */}
            {step.kind === "loop" && (
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
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── ログ出力 (#402) ──────────────────────────────── */}
            {step.kind === "log" && (
              <LogStepPanel
                step={step}
                onChange={(patch) => onChange(patch as Partial<Step>)}
                onCommit={onCommit}
                conventions={conventions ?? null}
              />
            )}

            {/* ── 監査ログ (#402) ──────────────────────────────── */}
            {step.kind === "audit" && (
              <AuditStepPanel
                step={step}
                onChange={(patch) => onChange(patch as Partial<Step>)}
                onCommit={onCommit}
                conventions={conventions ?? null}
              />
            )}

            {/* ── TX スコープ (#415) ────────────────────────────── */}
            {step.kind === "transactionScope" && (
              <TransactionScopeStepPanel
                step={step}
                onChange={(patch) => onChange(patch as Partial<Step>)}
                onCommit={onCommit}
                group={group}
                allSteps={allSteps}
                tables={tables}
                screens={screens}
                commonGroups={commonGroups}
                validationErrors={validationErrors}
                conventions={conventions ?? null}
                onNavigateCommon={onNavigateCommon}
              />
            )}

            {/* ── ジャンプ (Phase 5) ───────────────────────────── */}
            {step.kind === "jump" && (
              <div className="row g-2 mb-2">
                <div className="col-12">
                  <label className="form-label">ジャンプ先</label>
                  <JumpTargetSelector
                    value={step.jumpTo}
                    allSteps={allSteps}
                    excludeStepId={step.id}
                    onChange={(val) => onChange({ jumpTo: val } as Partial<Step>)}
                    onBlur={onCommit}
                  />
                </div>
              </div>
            )}

            {step.kind === "workflow" && (
              <WorkflowStepPanel
                step={step}
                allSteps={allSteps}
                conventions={conventions ?? null}
                onChange={(patch) => onChange(patch as Partial<Step>)}
                onCommit={onCommit}
                renderInlineStepList={({ steps, parentLabel, onChange: onStepsChange }) => (
                  <InlineStepList
                    steps={steps}
                    parentLabel={parentLabel}
                    allSteps={allSteps}
                    tables={tables}
                    screens={screens}
                    commonGroups={commonGroups}
                    onChange={onStepsChange}
                    onCommit={onCommit}
                    onNavigateCommon={onNavigateCommon}
                    validationErrors={validationErrors}
                    conventions={conventions}
                  />
                )}
              />
            )}

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
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
