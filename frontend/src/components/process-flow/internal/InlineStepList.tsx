// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
import { useState } from "react";
import type { ProcessFlow, Step, StepType } from "../../../types/action";
import {
  STEP_TYPE_COLORS,
  STEP_TYPE_ICONS,
  STEP_TYPE_LABELS,
} from "../../../types/action";
import { createDefaultStep } from "../../../store/processFlowStore";
import type { ValidationError } from "../../../utils/actionValidation";
import { generateUUID } from "../../../utils/uuid";
import { StepCard } from "../StepCard";
import { ALL_SUB_STEP_TYPES } from "./stepCardConstants";

export interface InlineStepListProps {
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
  conventions?: import("../../../schemas/conventionsValidator").ConventionsCatalog | null;
  group?: ProcessFlow | null;
  readOnly?: boolean;
}

/**
 * branch.steps / loop.steps の再帰レンダリング用インラインリスト。
 * StepCard との相互参照あり (StepCard の循環 import を避けるため別ファイル化、#1145)。
 *
 * 元: components/process-flow/StepCard.tsx の InlineStepList (#1145 で分離)
 *
 * ⚠️ 循環 import 注意 (#1158 review S-2): `StepCard` ⇔ `InlineStepList` の ESM 循環。
 * 両方とも `export function` (hoisted) のため module 評価順に依存せず TDZ 安全。
 * **将来 `let`/`const` declaration や lazy initialization へ変更する場合は TDZ で
 * 実行時 ReferenceError になる**ため、両ファイルとも function declaration を維持すること。
 */
export function InlineStepList({
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
  readOnly = false,
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
            readOnly={readOnly}
          />
        </div>
      ))}
      {!readOnly && (
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
      )}
    </div>
  );
}
