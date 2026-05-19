// Phase-3 (#1145): ProcessFlowEditor.tsx から ActionHelpPopover を抽出。
// アクションタブにホバー時のリッチヘルプ popover (契機 / 用途 / 定義例 / ステップ例 / メタ要約)。

import type { ActionDefinition, Marker } from "../../../types/v3";
import {
  countActionFields,
  getActionOpenMarkers,
  getActionTriggerCategory,
  getActionTriggerIcon,
  getActionTriggerLabel,
  getActionTriggerRichHelp,
  summarizeActionFields,
  summarizeActionMarkers,
  summarizeActionStepTypes,
} from "./actionTriggerConstants";

export interface ActionHelpPopoverProps {
  action: ActionDefinition;
  actionIndex: number;
  markers: Marker[];
  position: { left: number; top: number; placement: "below" | "above" };
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

export function ActionHelpPopover({
  action,
  actionIndex,
  markers,
  position,
  onPointerEnter,
  onPointerLeave,
}: ActionHelpPopoverProps) {
  const help = getActionTriggerRichHelp(action.trigger);
  const openMarkers = getActionOpenMarkers(action, actionIndex, markers);
  const stepCount = action.steps?.length ?? 0;
  const inputCount = countActionFields(action.inputs);
  const outputCount = countActionFields(action.outputs);
  const responseCount = countActionFields(action.responses);

  return (
    <div
      id={`action-help-${action.id}`}
      className={`process-flow-action-help ${position.placement}`}
      style={{ left: position.left, top: position.top }}
      role="tooltip"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className="process-flow-action-help-head">
        <span className="process-flow-action-help-icon" aria-hidden="true">
          <i className={`bi ${getActionTriggerIcon(action.trigger)}`} />
        </span>
        <div>
          <div className="process-flow-action-help-title">{action.name}</div>
          <div className="process-flow-action-help-subtitle">
            {getActionTriggerLabel(action.trigger)} / {getActionTriggerCategory(action.trigger)}
          </div>
        </div>
      </div>

      <div className="process-flow-action-help-grid">
        <section>
          <h6>契機</h6>
          <p>{help.occasion}</p>
        </section>
        <section>
          <h6>代表用途</h6>
          <ul>{help.useCases.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
        <section>
          <h6>定義例</h6>
          <p>{help.definitionExample}</p>
        </section>
        <section>
          <h6>ステップ例</h6>
          <ol>{help.stepExample.map((item) => <li key={item}>{item}</li>)}</ol>
        </section>
        <section>
          <h6>このアクション</h6>
          <dl>
            <div><dt>入出力</dt><dd>inputs {inputCount} / outputs {outputCount} / responses {responseCount}</dd></div>
            <div><dt>入力</dt><dd>{summarizeActionFields(action.inputs, "未定義")}</dd></div>
            <div><dt>出力</dt><dd>{summarizeActionFields(action.outputs, "未定義")}</dd></div>
            <div><dt>応答</dt><dd>{summarizeActionFields(action.responses, "未定義")}</dd></div>
            <div><dt>ステップ</dt><dd>{stepCount} 件 / {summarizeActionStepTypes(action)}</dd></div>
            <div><dt>成熟度</dt><dd>{action.maturity ?? "未設定"}</dd></div>
            <div><dt>未解決マーカー</dt><dd>{openMarkers.length} 件 / {summarizeActionMarkers(openMarkers)}</dd></div>
          </dl>
        </section>
        <section>
          <h6>注意点</h6>
          <ul>{help.notes.map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      </div>
    </div>
  );
}
