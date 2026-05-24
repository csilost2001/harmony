// #1260 Phase 2 sub-section B: EventSubscribe step に topic 補完 bind + filter ReferenceCompletionTextarea。
// topic は topicResolver (context.catalogs.events キー) で @reference 補完対応。
// filter は式入力のため ReferenceCompletionTextarea で補完対応 (#1282)。
// #1308 Phase B: filter textarea に @this / @self 補完を追加。

import type { EventSubscribeStep, EventTopic, ProcessFlow, TemplateString } from "../../../../types/v3";
import type { WorkspaceRefs } from "../../../../utils/reference-completer/types";
import { topicResolver } from "../../../../utils/reference-completer/workspaceResolver";
import { convResolver } from "../../../../utils/reference-completer/convResolver";
import { ALL_PROCESS_FLOW_SCOPE_RESOLVERS } from "../../../../utils/reference-completer/processFlowScopeResolver";
import { thisResolver } from "../../../../utils/reference-completer/thisResolver";
import { selfResolver } from "../../../../utils/reference-completer/selfResolver";
import { ReferenceCompletionInput } from "../../../common/ReferenceCompletionInput";
import { ReferenceCompletionTextarea } from "../../../common/ReferenceCompletionTextarea";
import type { ConventionsCatalog } from "../../../../schemas/conventionsValidator";
import type { StepCardBodyBaseProps } from "./types";

export interface EventSubscribeStepCardBodyProps extends StepCardBodyBaseProps<EventSubscribeStep> {
  workspace?: WorkspaceRefs;
  group?: ProcessFlow | null;
  conventions?: ConventionsCatalog | null;
}

export function EventSubscribeStepCardBody({
  step,
  onChange,
  onCommit,
  readOnly,
  workspace,
  group,
  conventions,
}: EventSubscribeStepCardBodyProps) {
  const filterResolvers = [convResolver, thisResolver, selfResolver, ...ALL_PROCESS_FLOW_SCOPE_RESOLVERS];
  const filterCtx = {
    conventions: conventions ?? null,
    flow: group ?? undefined,
    workspace,
    currentDocumentKind: "processFlow" as const,
    currentSelfRef: { kind: "step" as const, id: step.id },
  };
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
            <i className="bi bi-funnel me-1" />
            filter (式)
          </label>
          <ReferenceCompletionTextarea
            value={step.filter ?? ""}
            onValueChange={(v) => onChange({ filter: (v || undefined) as TemplateString | undefined })}
            onCommit={onCommit}
            resolvers={filterResolvers}
            ctx={filterCtx}
            className="form-control form-control-sm"
            placeholder="例: @event.amount > 1000"
            style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
            disabled={readOnly}
            rows={2}
          />
        </div>
      </div>
    </>
  );
}
