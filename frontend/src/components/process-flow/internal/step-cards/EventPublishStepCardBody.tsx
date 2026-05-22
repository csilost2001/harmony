// #1260 Phase 2 sub-section B: EventPublish step に topic 補完 bind + payload plain textarea。
// topic は topicResolver (context.catalogs.events キー) で @reference 補完対応。
// payload は式入力のため plain textarea (resolver 未対応)。

import type { EventPublishStep, EventTopic } from "../../../../types/v3";
import type { WorkspaceRefs } from "../../../../utils/reference-completer/types";
import { topicResolver } from "../../../../utils/reference-completer/workspaceResolver";
import { ReferenceCompletionInput } from "../../../common/ReferenceCompletionInput";
import type { StepCardBodyBaseProps } from "./types";

export interface EventPublishStepCardBodyProps extends StepCardBodyBaseProps<EventPublishStep> {
  workspace?: WorkspaceRefs;
}

export function EventPublishStepCardBody({
  step,
  onChange,
  onCommit,
  readOnly,
  workspace,
}: EventPublishStepCardBodyProps) {
  return (
    <>
      <div className="row g-2 mb-2">
        <div className="col-12">
          <label className="form-label">
            <i className="bi bi-broadcast-pin me-1" />
            topic
          </label>
          <ReferenceCompletionInput
            value={step.topic ?? ""}
            onValueChange={(v) => onChange({ topic: v as EventTopic })}
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
            <i className="bi bi-box-arrow-up me-1" />
            payload (式)
          </label>
          <textarea
            className="form-control form-control-sm"
            rows={2}
            value={step.payload ?? ""}
            onChange={(e) => onChange({ payload: e.target.value || undefined })}
            onBlur={onCommit}
            placeholder="例: @input.order"
            style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
            disabled={readOnly}
          />
        </div>
      </div>
    </>
  );
}
