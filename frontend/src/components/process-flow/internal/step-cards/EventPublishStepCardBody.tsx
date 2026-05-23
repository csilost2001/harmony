// #1260 Phase 2 sub-section B: EventPublish step に topic 補完 bind + payload ReferenceCompletionTextarea。
// topic は topicResolver (context.catalogs.events キー) で @reference 補完対応。
// payload は式入力のため ReferenceCompletionTextarea で補完対応 (#1282)。

import type { EventPublishStep, EventTopic, ProcessFlow, TemplateString } from "../../../../types/v3";
import type { WorkspaceRefs } from "../../../../utils/reference-completer/types";
import { topicResolver } from "../../../../utils/reference-completer/workspaceResolver";
import { convResolver } from "../../../../utils/reference-completer/convResolver";
import { ALL_PROCESS_FLOW_SCOPE_RESOLVERS } from "../../../../utils/reference-completer/processFlowScopeResolver";
import { ReferenceCompletionInput } from "../../../common/ReferenceCompletionInput";
import { ReferenceCompletionTextarea } from "../../../common/ReferenceCompletionTextarea";
import type { ConventionsCatalog } from "../../../../schemas/conventionsValidator";
import type { StepCardBodyBaseProps } from "./types";

export interface EventPublishStepCardBodyProps extends StepCardBodyBaseProps<EventPublishStep> {
  workspace?: WorkspaceRefs;
  group?: ProcessFlow | null;
  conventions?: ConventionsCatalog | null;
}

export function EventPublishStepCardBody({
  step,
  onChange,
  onCommit,
  readOnly,
  workspace,
  group,
  conventions,
}: EventPublishStepCardBodyProps) {
  const payloadResolvers = [convResolver, ...ALL_PROCESS_FLOW_SCOPE_RESOLVERS];
  const payloadCtx = { conventions: conventions ?? null, flow: group ?? undefined, workspace };
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
          <ReferenceCompletionTextarea
            value={step.payload ?? ""}
            onValueChange={(v) => onChange({ payload: (v || undefined) as TemplateString | undefined })}
            onCommit={onCommit}
            resolvers={payloadResolvers}
            ctx={payloadCtx}
            className="form-control form-control-sm"
            placeholder="例: { orderId: @var.action.order.id }"
            style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
            disabled={readOnly}
            rows={2}
          />
        </div>
      </div>
    </>
  );
}
