// Phase-3 (#1145、#1163 review Phase-2 補足): StepCard.tsx で dispatch が未実装だった
// `aiCall` kind (PR #935/#936 で schema 追加) に最小 body を提供する。
// AiCallStep: modelRef + messages + tools (任意) + responseFormat (任意)。
// #1016 follow-up (2026-05-20): generic StepCardBodyBaseProps<AiCallStep> で type narrow、@ts-nocheck 除去。
// #1258 follow-up: modelRef を ReferenceCompletionInput に置換して補完対応。

import type { AiCallStep, Identifier } from "../../../../types/v3";
import type { WorkspaceRefs } from "../../../../utils/reference-completer/types";
import { modelRefResolver } from "../../../../utils/reference-completer/workspaceResolver";
import { ReferenceCompletionInput } from "../../../common/ReferenceCompletionInput";
import type { StepCardBodyBaseProps } from "./types";

export interface AiCallStepCardBodyProps extends StepCardBodyBaseProps<AiCallStep> {
  workspace?: WorkspaceRefs;
}

export function AiCallStepCardBody({
  step,
  onChange,
  onCommit,
  workspace,
}: AiCallStepCardBodyProps) {
  const messages = Array.isArray(step.messages) ? step.messages : [];
  return (
    <>
      <div className="row g-2 mb-2">
        <div className="col-12">
          <label className="form-label">
            <i className="bi bi-cpu me-1" />
            modelRef (context.catalogs.modelEndpoints のキー)
          </label>
          <ReferenceCompletionInput
            value={step.modelRef ?? ""}
            onValueChange={(v) => onChange({ modelRef: v as Identifier })}
            onCommit={onCommit}
            resolvers={[modelRefResolver]}
            ctx={{ fieldKind: "modelRef", workspace }}
            className="form-control form-control-sm"
            placeholder="例: summarizeModel / projectModel"
            style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
          />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label small">
          <i className="bi bi-chat-left-text me-1" />
          messages ({messages.length} 件、JSON 形式)
        </label>
        <textarea
          className="form-control form-control-sm"
          rows={6}
          value={JSON.stringify(messages, null, 2)}
          onChange={(e) => {
            try {
              const parsed = JSON.parse(e.target.value);
              if (Array.isArray(parsed)) {
                onChange({ messages: parsed });
              }
            } catch {
              // JSON parse 失敗は無視 (blur で再 commit)
            }
          }}
          onBlur={onCommit}
          placeholder={'[\n  { "role": "system", "content": "..." },\n  { "role": "user", "content": "..." }\n]'}
          style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
        />
      </div>
      <div className="form-group">
        <label className="form-label small">
          <i className="bi bi-sliders me-1" />
          parameters (任意、JSON: temperature / maxTokens 等)
        </label>
        <textarea
          className="form-control form-control-sm"
          rows={2}
          value={step.parameters ? JSON.stringify(step.parameters, null, 2) : ""}
          onChange={(e) => {
            const trimmed = e.target.value.trim();
            if (!trimmed) {
              onChange({ parameters: undefined });
              return;
            }
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed && typeof parsed === "object") {
                onChange({ parameters: parsed });
              }
            } catch {
              // ignore
            }
          }}
          onBlur={onCommit}
          placeholder='{"temperature": 0.2, "maxTokens": 800}'
          style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
        />
      </div>
    </>
  );
}
