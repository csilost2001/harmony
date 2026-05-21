// Phase-3 (#1145): ProcessFlowEditor.tsx 中央キャンバス (ステップリスト) を抽出。
// SortableContext + 各 SortableStepCard + StepInsertZone の組合せ。

import type { RefObject } from "react";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { ActionDefinition, Marker, ProcessFlow, Step, StepType } from "../../../types/v3";
import type { ConventionsCatalog } from "../../../schemas/conventionsValidator";
import { SortableStepCard } from "../SortableStepCard";
import { EmptyFlowDropZone, StepInsertZone } from "./PaletteButtons";
import { getStepLabel } from "../../../utils/actionUtils";
import { generateUUID } from "../../../utils/uuid";
import type { ValidationError } from "../../../utils/actionValidation";
import type { UseAiContextChipsResult } from "../../../hooks/useAiContextChips";
import type { EditLevel } from "../../../hooks/useEditLevel";
import type { WorkspaceRefs } from "../../../utils/reference-completer/types";

export interface CanvasPaneProps {
  group: ProcessFlow | null;
  activeAction: ActionDefinition | null;
  tables: { id: string; physicalName: string; name: string }[];
  screens: { id: string; name: string }[];
  commonGroups: { id: string; name: string }[];
  conventions: ConventionsCatalog | null;
  isReadonly: boolean;
  isDraggingToolbarStep: boolean;
  clipboard: { steps: Step[]; mode: "cut" | "copy" } | null;
  newStepIds: Set<string>;
  selectedIds: Set<string>;
  validationErrors: ValidationError[];
  editLevel: EditLevel;
  stepListRef: RefObject<HTMLDivElement | null>;
  aiChips: UseAiContextChipsResult;
  aiPanelRef: RefObject<HTMLDivElement | null>;
  /** step 操作 */
  handleAddStep: (kind: StepType, insertIndex?: number) => void;
  handlePaste: (insertIndex?: number) => void;
  handleStepChange: (stepId: string, changes: Partial<Step>) => void;
  commitGroup: () => void;
  handleMoveStep: (fromIndex: number, toIndex: number) => void;
  handleDeleteStep: (stepId: string) => void;
  handleDuplicateStep: (stepId: string) => void;
  handleAddSubStep: (parentStepId: string, kind: StepType) => void;
  handleIndentStep: (stepId: string) => void;
  handleOutdentSubStep: (parentStepId: string, subStepId: string) => void;
  handleStepClick: (stepId: string, e: React.MouseEvent) => void;
  onNavigateCommon: (refId: string) => void;
  /** マーカー追加 (StepCard 内 onAddMarker) */
  updateGroupWithDraft: (fn: (g: ProcessFlow) => void) => void;
  /** context menu open */
  onContextMenu: (stepId: string, x: number, y: number) => void;
  /** 選択状態 */
  setSelectedIds: (ids: Set<string>) => void;
  /** 最終選択 ref (Shift+Click 範囲選択用) */
  lastSelectedIdRef: { current: string | null };
  /** #1258 workspace 参照情報 (componentRef / modelRef 補完用) */
  workspace?: WorkspaceRefs;
}

export function CanvasPane({
  group,
  activeAction,
  tables,
  screens,
  commonGroups,
  conventions,
  isReadonly,
  isDraggingToolbarStep,
  clipboard,
  newStepIds,
  selectedIds,
  validationErrors,
  editLevel,
  stepListRef,
  aiChips,
  aiPanelRef,
  handleAddStep,
  handlePaste,
  handleStepChange,
  commitGroup,
  handleMoveStep,
  handleDeleteStep,
  handleDuplicateStep,
  handleAddSubStep,
  handleIndentStep,
  handleOutdentSubStep,
  handleStepClick,
  onNavigateCommon,
  updateGroupWithDraft,
  onContextMenu,
  setSelectedIds,
  lastSelectedIdRef,
  workspace,
}: CanvasPaneProps) {
  return (
    <main className="process-flow-canvas-pane">
      <div className="process-flow-canvas-header">
        <div>
          <span className="process-flow-pane-kicker">Flow</span>
          <h6>{activeAction ? `${activeAction.name} の処理` : "処理フロー"}</h6>
        </div>
        {activeAction && (
          <div className="process-flow-canvas-metrics">
            <span>{activeAction.steps.length} steps</span>
            <span>{activeAction.inputs?.length ?? 0} inputs</span>
            <span>{activeAction.outputs?.length ?? 0} outputs</span>
          </div>
        )}
      </div>
      <div className="process-flow-content">
        {activeAction ? (
          <div className="step-editor">
            {activeAction.steps.length === 0 ? (
              <EmptyFlowDropZone disabled={isReadonly}>
                <i className="bi bi-plus-circle" />
                <strong>ステップがありません</strong>
                <span>
                  {isReadonly
                    ? "編集開始後にステップを追加できます。"
                    : "左のブロックをドラッグするか、ブロックをクリックして追加してください。"}
                </span>
                <StepInsertZone
                  index={0}
                  onClick={() => handleAddStep("other")}
                  onPaste={clipboard && !isReadonly ? () => handlePaste(0) : undefined}
                  dragVisible={isDraggingToolbarStep}
                  disabled={isReadonly}
                />
              </EmptyFlowDropZone>
            ) : (
              <SortableContext
                items={activeAction.steps.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div
                  className={`step-list${isDraggingToolbarStep ? " drag-inserting" : ""}`}
                  ref={stepListRef}
                >
                  {activeAction.steps.map((step, index) => {
                    const stepMarkers = (group?.authoring?.markers ?? []).filter(
                      (m) => !m.resolvedAt && m.anchor?.stepId === step.id,
                    );
                    const markerCount = stepMarkers.length;
                    const markerTooltip =
                      markerCount > 0
                        ? `AI 依頼マーカー ${markerCount} 件:\n${stepMarkers
                            .map((m) => `- [${m.kind}] ${m.body.slice(0, 60)}`)
                            .join("\n")}`
                        : undefined;
                    const markerKinds =
                      markerCount > 0
                        ? {
                            todo: stepMarkers.filter((m) => m.kind === "todo").length,
                            question: stepMarkers.filter((m) => m.kind === "question").length,
                            attention: stepMarkers.filter((m) => m.kind === "attention").length,
                            chat: stepMarkers.filter((m) => m.kind === "chat").length,
                            validator: stepMarkers.filter((m) => m.kind === "validator").length,
                          }
                        : undefined;
                    return (
                      <div key={step.id}>
                        <StepInsertZone
                          index={index}
                          onClick={() => handleAddStep("other", index)}
                          onPaste={
                            clipboard && !isReadonly ? () => handlePaste(index) : undefined
                          }
                          dragVisible={isDraggingToolbarStep}
                          disabled={isReadonly}
                        />
                        <SortableStepCard
                          step={step}
                          index={index}
                          label={getStepLabel(index)}
                          allSteps={activeAction.steps}
                          tables={tables}
                          screens={screens}
                          commonGroups={commonGroups}
                          workspace={workspace}
                          onChange={(changes) => handleStepChange(step.id, changes)}
                          onCommit={commitGroup}
                          onMoveUp={
                            index > 0 ? () => handleMoveStep(index, index - 1) : undefined
                          }
                          onMoveDown={
                            index < activeAction.steps.length - 1
                              ? () => handleMoveStep(index, index + 1)
                              : undefined
                          }
                          onDelete={() => handleDeleteStep(step.id)}
                          onDuplicate={() => handleDuplicateStep(step.id)}
                          onAddSubStep={(kind) => handleAddSubStep(step.id, kind)}
                          onContextMenu={(e) => {
                            e.preventDefault();
                            if (isReadonly) return;
                            setSelectedIds(new Set([step.id]));
                            lastSelectedIdRef.current = step.id;
                            onContextMenu(step.id, e.clientX, e.clientY);
                          }}
                          onNavigateCommon={onNavigateCommon}
                          defaultExpanded={newStepIds.has(step.id)}
                          selected={selectedIds.has(step.id)}
                          onHeaderClick={(e) => handleStepClick(step.id, e)}
                          onIndent={index > 0 ? () => handleIndentStep(step.id) : undefined}
                          onOutdentSubStep={(subId) =>
                            handleOutdentSubStep(step.id, subId)
                          }
                          validationErrors={validationErrors}
                          onAddMarker={(body, kind = "todo") => {
                            updateGroupWithDraft((g) => {
                              const m: Marker = {
                                id: generateUUID() as Marker["id"],
                                kind,
                                body,
                                anchor: { stepId: step.id },
                                author: "human",
                                createdAt: new Date().toISOString() as Marker["createdAt"],
                              };
                              g.authoring = {
                                ...(g.authoring ?? {}),
                                markers: [...(g.authoring?.markers ?? []), m],
                              };
                            });
                          }}
                          markerCount={markerCount}
                          markerTooltip={markerTooltip}
                          markerKinds={markerKinds}
                          conventions={conventions}
                          group={group}
                          editLevel={editLevel}
                          readOnly={isReadonly}
                          onAskAi={() => {
                            const label = `S${index + 1}: ${step.description ?? step.kind ?? step.id}`;
                            aiChips.addStepChip(String(step.id), label, step);
                            aiPanelRef.current?.scrollIntoView({
                              behavior: "smooth",
                              block: "nearest",
                            });
                          }}
                        />
                      </div>
                    );
                  })}
                  <StepInsertZone
                    index={activeAction.steps.length}
                    onClick={() => handleAddStep("other")}
                    onPaste={
                      clipboard && !isReadonly
                        ? () => handlePaste(activeAction.steps.length)
                        : undefined
                    }
                    dragVisible={isDraggingToolbarStep}
                    disabled={isReadonly}
                  />
                </div>
              </SortableContext>
            )}
          </div>
        ) : (
          <div className="step-empty process-flow-empty-drop">
            <i className="bi bi-lightning" />
            <strong>アクションがありません</strong>
            <span>上部の + ボタンからアクションを追加してください。</span>
          </div>
        )}
      </div>
    </main>
  );
}
