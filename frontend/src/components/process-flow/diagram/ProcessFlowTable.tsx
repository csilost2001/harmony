/**
 * 処理記述表 (日本の処理設計書の形式)。No / 処理 / 対象 / 条件・備考。
 * 入れ子は字下げ、トランザクション内は帯、異常終了は赤で示す。
 */
import { useMemo } from "react";
import type { ActionDefinition } from "../../../types/v3";
import { buildOutline, type FlowContext } from "./flowStructure";

export interface ProcessFlowTableProps {
  action: ActionDefinition;
  ctx: FlowContext;
  selectedStepIds: ReadonlySet<string>;
  onSelectStep: (stepId: string) => void;
  onOpenStep: (stepId: string) => void;
}

export function ProcessFlowTable({ action, ctx, selectedStepIds, onSelectStep, onOpenStep }: ProcessFlowTableProps) {
  const rows = useMemo(() => buildOutline(action.steps ?? [], action, ctx), [action, ctx]);
  return (
    <div className="pft-scroll" data-testid="process-flow-table">
      <table className="pft-table">
        <caption className="pft-caption">
          {action.name}（{action.httpRoute ? `${action.httpRoute.method} ${action.httpRoute.path}` : action.trigger}）
          <span>入力 {action.inputs?.length ?? 0} 件 / 出力 {action.outputs?.length ?? 0} 件</span>
        </caption>
        <thead>
          <tr>
            <th scope="col" className="pft-no">No</th>
            <th scope="col" className="pft-kind">区分</th>
            <th scope="col">処理内容</th>
            <th scope="col" className="pft-target">対象</th>
            <th scope="col" className="pft-note">条件・備考</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sel = r.step && selectedStepIds.has(r.step.id);
            return (
              <tr
                key={r.no}
                className={`pft-row pft-${r.type}${r.inTx ? " is-tx" : ""}${r.isError ? " is-error" : ""}${sel ? " is-selected" : ""}`}
                onClick={r.step ? () => onSelectStep(r.step!.id) : undefined}
                onDoubleClick={r.step ? () => onOpenStep(r.step!.id) : undefined}
                data-testid={r.step ? `pft-row-${r.step.id}` : undefined}
              >
                <td className="pft-no">{r.no}</td>
                <td className="pft-kind">{r.kind}</td>
                <td><span style={{ paddingLeft: r.depth * 16 }} className="pft-text">{r.type === "branch-arm" ? `▸ ${r.text}` : r.text}</span></td>
                <td className="pft-target">{r.target}</td>
                <td className="pft-note">{r.note}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr><td colSpan={5} className="pft-empty">ステップがありません</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
