/**
 * 処理フローの構造解析 (図 / 処理記述表)。実体は @harmony/shared の flowStructure
 * (HTML 設計書出力と共通)。ここでは v3 の型 (ActionDefinition / Step) で呼べるようにする。
 */
import {
  buildOutline as coreBuildOutline,
  layoutFlow as coreLayoutFlow,
  returnStatus as coreReturnStatus,
  stepTarget as coreStepTarget,
  type DiagramLayout,
  type FlowActionLike,
  type FlowContext,
  type FlowStep,
  type OutlineRow,
} from "@harmony/shared";
import type { ActionDefinition, Step } from "../../../types/v3";

export type { DiagramEdge, DiagramFrame, DiagramLayout, DiagramNode, FlowContext, NodeTone, OutlineRow } from "@harmony/shared";
export { kindLabel, stepNote, stepText, truncate } from "@harmony/shared";

const asSteps = (steps: readonly Step[]) => steps as unknown as FlowStep[];
const asAction = (a: unknown) => a as FlowActionLike;

export function buildOutline(steps: readonly Step[], action: Pick<ActionDefinition, "responses"> | null, ctx?: FlowContext): OutlineRow[] {
  return coreBuildOutline(asSteps(steps), action ? asAction(action) : null, ctx);
}

export function layoutFlow(action: Pick<ActionDefinition, "name" | "trigger" | "steps" | "responses">, ctx?: FlowContext): DiagramLayout {
  return coreLayoutFlow(asAction(action), ctx);
}

export function stepTarget(step: Step, ctx?: FlowContext): string {
  return coreStepTarget(step as unknown as FlowStep, ctx);
}

export function returnStatus(step: Step, action: Pick<ActionDefinition, "responses"> | null): number | undefined {
  return coreReturnStatus(step as unknown as FlowStep, action ? asAction(action) : null);
}
