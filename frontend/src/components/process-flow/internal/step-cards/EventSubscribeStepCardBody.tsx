// #1260 Phase 2 sub-section B: EventSubscribe step に topic 補完 bind + filter plain textarea。
// topic は topicResolver (context.catalogs.events キー) で @reference 補完対応。
// filter は式入力のため plain textarea (resolver 未対応)。

import type { EventSubscribeStep } from "../../../../types/v3";
import type { WorkspaceRefs } from "../../../../utils/reference-completer/types";
import { topicResolver } from "../../../../utils/reference-completer/workspaceResolver";
import { ReferenceCompletionInput } from "../../../common/ReferenceCompletionInput";
import type { StepCardBodyBaseProps } from "./types";

export interface EventSubscribeStepCardBodyProps extends StepCardBodyBaseProps<EventSubscribeStep> {
  workspace?: WorkspaceRefs;
}

export function EventSubscribeStepCardBody({
  step,
  onChange,
  onCommit,
  readOnly,
  workspace,
}: EventSubscribeStepCardBodyProps) {
  return (
    <>
      <div className="row g-2 mb-2">
        <div className="col-12">
          <label className="form-label">
            <i className="bi bi-broadcast me-1" />
            topic
          </label>
          <ReferenceCompletionInput
            value={step.topic ?? ""}
            onValueChange={(v) => onChange({ topic: v as never })}
            onCommit={onCommit}
            resolvers={[topicResolver]}
            ctx={{ fieldKind: "topic", workspace }}
            className="form-control form-control-sm"
            placeholder="例: order.placed (context.catalogs.events のキー)"
            style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
            disabled={readOnly}
          />
        </div>
      </div>
      <div className="row g-2 mb-2">
        <div className="col-12">
          <label className="form-label">
            <i className="bi bi-funnel me-1" />
            filter (式)
          </label>
          <textarea
            className="form-control form-control-sm"
            rows={2}
            value={step.filter ?? ""}
            onChange={(e) => onChange({ filter: e.target.value || undefined })}
            onBlur={onCommit}
            placeholder="例: @event.amount > 1000"
            style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
            disabled={readOnly}
          />
        </div>
      </div>
    </>
  );
}
