// Phase-3 (#1145、#1163 review Phase-2 補足): StepCard.tsx で dispatch が未実装だった
// `aiAgent` kind (PR #935/#936 で schema 追加) に最小 body を提供する。
// AiAgentStep: modelRef + messages + tools (1 件以上必須) + maxIterations。
// multi-step agent loop。tool が無い single-shot は AiCallStep を使う。
// #1016 follow-up (2026-05-20): generic StepCardBodyBaseProps<AiAgentStep> で type narrow、@ts-nocheck 除去。
// #1258 follow-up: modelRef を ReferenceCompletionInput に置換して補完対応。

import type { AiAgentStep, Identifier } from "../../../../types/v3";
import type { WorkspaceRefs } from "../../../../utils/reference-completer/types";
import { modelRefResolver } from "../../../../utils/reference-completer/workspaceResolver";
import { ReferenceCompletionInput } from "../../../common/ReferenceCompletionInput";
import type { StepCardBodyBaseProps } from "./types";

export interface AiAgentStepCardBodyProps extends StepCardBodyBaseProps<AiAgentStep> {
  workspace?: WorkspaceRefs;
}

export function AiAgentStepCardBody({
  step,
  onChange,
  onCommit,
  workspace,
}: AiAgentStepCardBodyProps) {
  const messages = Array.isArray(step.messages) ? step.messages : [];
  const tools = Array.isArray(step.tools) ? step.tools : [];
  return (
    <>
      <div className="row g-2 mb-2">
        <div className="col-8">
          <label className="form-label">
            <i className="bi bi-robot me-1" />
            modelRef
          </label>
          <ReferenceCompletionInput
            value={step.modelRef ?? ""}
            onValueChange={(v) => onChange({ modelRef: v as Identifier })}
            onCommit={onCommit}
            resolvers={[modelRefResolver]}
            ctx={{ fieldKind: "modelRef", workspace }}
            className="form-control form-control-sm"
            placeholder="例: agentModel"
            style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
          />
        </div>
        <div className="col-4">
          <label className="form-label">
            <i className="bi bi-arrow-repeat me-1" />
            maxIterations
          </label>
          <input
            type="number"
            className="form-control form-control-sm"
            min={1}
            value={step.maxIterations ?? 10}
            onChange={(e) => onChange({ maxIterations: Number(e.target.value) || 1 })}
            onBlur={onCommit}
          />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label small">
          <i className="bi bi-chat-left-text me-1" />
          初期 messages ({messages.length} 件、JSON 形式)
        </label>
        <textarea
          className="form-control form-control-sm"
          rows={5}
          value={JSON.stringify(messages, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              if (Array.isArray(parsed)) {
                onChange({ messages: parsed });
              }
            } catch {
              // ignore
            }
          }}
          onBlur={onCommit}
          placeholder={'[\n  { "role": "system", "content": "..." },\n  { "role": "user", "content": "..." }\n]'}
          style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
        />
      </div>
      <div className="form-group">
        <label className="form-label small">
          <i className="bi bi-tools me-1" />
          tools ({tools.length} 件、JSON 形式、1 件以上必須)
        </label>
        <textarea
          className="form-control form-control-sm"
          rows={4}
          value={JSON.stringify(tools, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              if (Array.isArray(parsed)) {
                onChange({ tools: parsed });
              }
            } catch {
              // ignore
            }
          }}
          onBlur={onCommit}
          placeholder={'[\n  { "functionRef": "catalogs.functions.search" }\n]'}
          style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
        />
      </div>
    </>
  );
}
