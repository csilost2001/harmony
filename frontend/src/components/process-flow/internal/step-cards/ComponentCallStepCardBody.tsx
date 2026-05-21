// Phase-3 (#1145、#1163 review Phase-2 補足): StepCard.tsx で dispatch が未実装だった
// `componentCall` kind (PR #1066 で schema 追加) に最小 body を提供する。
// CommonProcessStepCardBody と類似 (componentRef + operation + argumentMapping / returnMapping)。
// #1258 follow-up: componentRef を ReferenceCompletionInput に置換して補完対応。

import type { ComponentCallStep } from "../../../../types/v3";
import type { WorkspaceRefs } from "../../../../utils/reference-completer/types";
import { componentRefResolver } from "../../../../utils/reference-completer/workspaceResolver";
import { ReferenceCompletionInput } from "../../../common/ReferenceCompletionInput";
import type { StepCardBodyBaseProps } from "./types";

export interface ComponentCallStepCardBodyProps extends StepCardBodyBaseProps<ComponentCallStep> {
  workspace?: WorkspaceRefs;
}

export function ComponentCallStepCardBody({
  step,
  onChange,
  onCommit,
  workspace,
}: ComponentCallStepCardBodyProps) {
  return (
    <>
      <div className="row g-2 mb-2">
        <div className="col-12">
          <label className="form-label">
            <i className="bi bi-puzzle me-1" />
            コンポーネント参照 (componentRef)
          </label>
          <ReferenceCompletionInput
            value={step.componentRef ?? ""}
            onValueChange={(v) => onChange({ componentRef: v })}
            onCommit={onCommit}
            resolvers={[componentRefResolver]}
            ctx={{ fieldKind: "componentRef", workspace }}
            className="form-control form-control-sm"
            placeholder="例: generic-definitions/component-definition/OrderValidator"
            style={{ fontFamily: "monospace", fontSize: "0.85rem" }}
          />
        </div>
      </div>
      <div className="row g-2 mb-2">
        <div className="col-12">
          <label className="form-label">
            <i className="bi bi-play me-1" />
            operation
          </label>
          <input
            type="text"
            className="form-control form-control-sm"
            value={step.operation ?? ""}
            onChange={(e) => onChange({ operation: e.target.value })}
            onBlur={onCommit}
            placeholder="例: validate"
          />
        </div>
      </div>
      <div className="form-group">
        <label className="form-label small">
          <i className="bi bi-arrow-left-right me-1" />
          引数マッピング (argumentMapping、key=value、改行区切り)
        </label>
        <textarea
          className="form-control form-control-sm"
          rows={2}
          value={Object.entries(step.argumentMapping ?? {}).map(([k, v]) => `${k}=${v}`).join("\n")}
          onChange={(e) => {
            const lines = e.target.value.split("\n").map((l) => l.trim()).filter(Boolean);
            const map: Record<string, string> = {};
            for (const line of lines) {
              const eq = line.indexOf("=");
              if (eq > 0) {
                map[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
              }
            }
            onChange({
              argumentMapping: Object.keys(map).length > 0 ? map : undefined,
            });
          }}
          onBlur={onCommit}
          placeholder={"order=@input.order\nstrict=true"}
          style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
        />
      </div>
      <div className="form-group">
        <label className="form-label small">
          <i className="bi bi-arrow-return-right me-1" />
          戻り値マッピング (returnMapping、key=value、改行区切り)
        </label>
        <textarea
          className="form-control form-control-sm"
          rows={2}
          value={Object.entries(step.returnMapping ?? {}).map(([k, v]) => `${k}=${v}`).join("\n")}
          onChange={(e) => {
            const lines = e.target.value.split("\n").map((l) => l.trim()).filter(Boolean);
            const map: Record<string, string> = {};
            for (const line of lines) {
              const eq = line.indexOf("=");
              if (eq > 0) {
                map[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
              }
            }
            onChange({
              returnMapping: Object.keys(map).length > 0 ? map : undefined,
            });
          }}
          onBlur={onCommit}
          placeholder={"isValid=successFlag\nerrors=validationErrors"}
          style={{ fontFamily: "monospace", fontSize: "0.8rem" }}
        />
      </div>
    </>
  );
}
