// @ts-nocheck -- StepCard と同じ legacy/v3 union 緩和理由 (#1016)
// Phase-3 (#1145、#1163 review Phase-2 補足): StepCard.tsx で dispatch が未実装だった
// `aiCall` kind (PR #935/#936 で schema 追加) に最小 body を提供する。
// AiCallStep: modelRef + messages + tools (任意) + responseFormat (任意)。

import type { Step } from "../../../../types/v3";
import type { StepCardBodyBaseProps } from "./types";

export type AiCallStepCardBodyProps = StepCardBodyBaseProps;

export function AiCallStepCardBody({
  step,
  onChange,
  onCommit,
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
          <input
            type="text"
            className="form-control form-control-sm"
            value={step.modelRef ?? ""}
            onChange={(e) => onChange({ modelRef: e.target.value } as Partial<Step>)}
            onBlur={onCommit}
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
                onChange({ messages: parsed } as Partial<Step>);
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
              onChange({ parameters: undefined } as Partial<Step>);
              return;
            }
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed && typeof parsed === "object") {
                onChange({ parameters: parsed } as Partial<Step>);
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
