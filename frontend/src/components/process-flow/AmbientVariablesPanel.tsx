// @ts-nocheck
/**
 * ProcessFlow.ambientVariables 編集パネル (#278)
 *
 * middleware 由来の自動注入変数 (@requestId, @traceId, @fieldErrors 等) を
 * StructuredField[] として宣言する UI。
 */
import { useState } from "react";
import type { ProcessFlow, StructuredField, FieldType } from "../../types/action";

interface Props {
  group: ProcessFlow;
  onChange: (group: ProcessFlow) => void;
  expanded?: boolean;
  onExpandedChange?: (next: boolean) => void;
  render?: "full" | "toggleOnly" | "bodyOnly";
}

const PRIMITIVE_TYPES: Array<FieldType & string> = ["string", "number", "boolean", "date"];

export function AmbientVariablesPanel({ group, onChange, expanded: expandedProp, onExpandedChange, render = "full" }: Props) {
  const [expandedState, setExpandedState] = useState(false);
  const isControlled = expandedProp !== undefined;
  const expanded = isControlled ? expandedProp : expandedState;
  const setExpanded = (next: boolean) => {
    if (!isControlled) setExpandedState(next);
    onExpandedChange?.(next);
  };
  const vars = group.context?.ambientVariables ?? [];

  const setVars = (next: StructuredField[] | undefined) => {
    onChange({ ...group, context: { ...(group.context ?? {}), ambientVariables: next } });
  };

  const update = (idx: number, patch: Partial<StructuredField>) => {
    const next = vars.map((v, i) => (i === idx ? { ...v, ...patch } : v));
    setVars(next);
  };

  const add = () => {
    const next: StructuredField[] = [...vars, { name: "", type: "string" }];
    setVars(next);
  };

  const remove = (idx: number) => {
    const next = vars.filter((_, i) => i !== idx);
    setVars(next.length > 0 ? next : undefined);
  };

  const showToggle = render !== "bodyOnly";
  const showBody = render === "bodyOnly" || (render !== "toggleOnly" && expanded);
  return (
    <div className="catalog-panel ambient-variables-panel">
      {showToggle && (
        <button
          type="button"
          className="catalog-panel-toggle"
          onClick={() => setExpanded(!expanded)}
        >
          <i className={`bi bi-chevron-${expanded ? "down" : "right"}`} />
          <i className="bi bi-box-arrow-in-down-left" />
          {" "}Ambient 変数 (ambientVariables: {vars.length} 件)
        </button>
      )}
      {showBody && (
        <div className="catalog-panel-body">
          <div className="catalog-help">
            ミドルウェア / フレームワーク由来の自動注入変数を宣言。@requestId / @traceId /
            @fieldErrors 等、inputs にも outputBinding にも無い @ 参照を valid 化。
          </div>
          {vars.length === 0 && <div className="catalog-empty">まだエントリがありません。</div>}
          {vars.map((v, i) => {
            return (
              <div className="catalog-row" key={i}>
                <div className="catalog-row-header">
                  <span className="catalog-key-badge">{v.name || "(名前未設定)"}</span>
                  <label className="ms-auto me-2 small d-flex align-items-center gap-1">
                    <input
                      type="checkbox"
                      checked={!!v.required}
                      onChange={(ev) => update(i, { required: ev.target.checked || undefined })}
                    />
                    必須
                  </label>
                  <button
                    type="button"
                    className="btn btn-sm btn-link text-danger"
                    onClick={() => remove(i)}
                    title="削除"
                  >
                    <i className="bi bi-trash" />
                  </button>
                </div>
                <div className="catalog-row-fields">
                  <label>
                    name
                    <input
                      className="form-control form-control-sm"
                      value={v.name}
                      onChange={(ev) => update(i, { name: ev.target.value })}
                    />
                  </label>
                  <label>
                    type
                    <input
                      list="ambient-variables-type-list"
                      className="form-control form-control-sm"
                      value={typeof v.type === "string"
                        ? v.type
                        : v.type.kind === "custom"
                          ? v.type.label ?? ""
                          : ""}
                      onChange={(ev) => {
                        const t = ev.target.value;
                        if (t === "") {
                          update(i, { type: "string" });
                        } else if ((PRIMITIVE_TYPES as string[]).includes(t)) {
                          update(i, { type: t as FieldType });
                        } else {
                          update(i, { type: { kind: "custom", label: t } });
                        }
                      }}
                      placeholder="型 (string/DTO名 等)"
                      title={typeof v.type === "object" && v.type.kind === "custom"
                        ? `カスタム型: ${v.type.label}`
                        : undefined}
                    />
                  </label>
                  <label className="catalog-wide">
                    description
                    <input
                      className="form-control form-control-sm"
                      value={v.description ?? ""}
                      onChange={(ev) => update(i, { description: ev.target.value || undefined })}
                      placeholder="例: X-Request-Id 注入"
                    />
                  </label>
                </div>
              </div>
            );
          })}
          <div className="catalog-row catalog-row-add">
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={add}>
              <i className="bi bi-plus-lg" /> 追加
            </button>
          </div>
          {/* 型入力の候補 (primitive のみ提示、自由入力も可) — 全 row 共有 */}
          <datalist id="ambient-variables-type-list">
            {PRIMITIVE_TYPES.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
      )}
    </div>
  );
}
