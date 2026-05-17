// ── browser-first 処理フロー変異ヘルパー (#361 由来、#1149 で v3 化) ──────────
//
// AI コーディングエージェントが MCP tool `designer__add_step` 等を呼んだとき、
// backend `applyProcessFlowMutation` (PR #1148 で v3 化) が WS 経由で本関数を
// invoke する。ProcessFlowEditor が開いている間の in-memory mutation を担当し、
// 保存で確定するまでファイルベース (processFlowEdits.ts) と独立に動く。
//
// v3 構造の主要点 (#1141 / PR #1148 完了済):
// - discriminator は `kind` (旧 `type` field は全廃)
// - id は RFC 4122 v4 UUID (legacy `ag-`/`act-`/`step-` prefix は受容しない)
// - meta / context / actions / authoring の 4 並列構造
//
// backend handler は `params: a` (元の args) をそのまま送るので、
// ここでは `p.kind` / `p.actionId` / `p.stepId` / `p.patch` / `p.newIndex` /
// `p.position` / `p.description` / `p.detail` を読む。
//
// ProcessFlowEditor.tsx (94KB) から本ファイルに切り出した理由は、
// vitest unit test で巨大コンポーネント (GrapesJS / ReactFlow 等) を
// 巻き込まずに mutation ロジックを単体検証するため。

import type { ProcessFlow, StepType } from "../../types/action";
import { addStep, removeStep, moveStep } from "../../store/processFlowStore";

export function applyProcessFlowMutation(
  g: ProcessFlow,
  type: string,
  p: Record<string, unknown>,
): void {
  switch (type) {
    case "designer__add_step": {
      const act = g.actions.find((a: { id: string }) => a.id === p.actionId);
      if (!act) return;
      const pos = typeof p.position === "number" ? p.position : undefined;
      // v3: backend は `kind` を送る (旧 `type` は #1148 で全廃)。
      const kind = p.kind as StepType | undefined;
      if (!kind) return;
      const step = addStep(act, kind, pos);
      if (p.description) step.description = p.description as string;
      Object.assign(step, (p.detail ?? {}) as object);
      break;
    }
    case "designer__update_step": {
      for (const act of g.actions) {
        const step = act.steps.find((s: { id: string }) => s.id === p.stepId);
        if (step) { Object.assign(step, p.patch); return; }
      }
      break;
    }
    case "designer__remove_step": {
      for (const act of g.actions) {
        const idx = act.steps.findIndex((s: { id: string }) => s.id === p.stepId);
        if (idx >= 0) { removeStep(act, p.stepId as string); return; }
      }
      break;
    }
    case "designer__move_step": {
      const newIndex = p.newIndex as number;
      for (const act of g.actions) {
        const fromIdx = act.steps.findIndex((s: { id: string }) => s.id === p.stepId);
        if (fromIdx >= 0) { moveStep(act, fromIdx, newIndex); return; }
      }
      break;
    }
  }
}
