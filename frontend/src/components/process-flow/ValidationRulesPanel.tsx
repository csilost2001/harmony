import { useState } from "react";
import type { ValidationRule, ValidationRuleType } from "../../types/action";
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";
import { ConvCompletionInput } from "../common/ConvCompletionInput";

interface Props {
  rules: ValidationRule[] | undefined;
  onChange: (rules: ValidationRule[]) => void;
  conventions?: ConventionsCatalog | null;
}

const RULE_TYPES: Array<{ value: ValidationRuleType; label: string }> = [
  { value: "required", label: "required (必須)" },
  { value: "regex", label: "regex (正規表現)" },
  { value: "maxLength", label: "maxLength (最大長)" },
  { value: "minLength", label: "minLength (最小長)" },
  { value: "range", label: "range (数値範囲)" },
  { value: "enum", label: "enum (列挙)" },
  { value: "custom", label: "custom (自由式)" },
];

/**
 * ValidationStep.rules[] 編集 UI (#212)。
 * 構造化ルール配列の追加/編集/削除。
 */
export function ValidationRulesPanel({ rules, onChange, conventions }: Props) {
  const list = rules ?? [];
  const [expanded, setExpanded] = useState(list.length > 0);

  const addRule = () => {
    onChange([...list, { field: "", type: "required" }]);
    setExpanded(true);
  };

  const updateRule = (idx: number, patch: Partial<ValidationRule>) => {
    onChange(list.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRule = (idx: number) => {
    onChange(list.filter((_, i) => i !== idx));
  };

  return (
    <div className="validation-rules-panel" style={{ marginTop: 8 }}>
      <div className="d-flex align-items-center gap-2 mb-1">
        <button
          type="button"
          className="btn btn-sm btn-link p-0 text-dark"
          onClick={() => setExpanded((v) => !v)}
          style={{ fontSize: "0.85rem" }}
        >
          <i className={`bi ${expanded ? "bi-chevron-down" : "bi-chevron-right"} me-1`} />
          <i className="bi bi-check2-square me-1" />
          構造化ルール (rules[]: {list.length} 件)
        </button>
        <button
          type="button"
          className="btn btn-sm btn-outline-secondary py-0"
          onClick={addRule}
          style={{ fontSize: "0.75rem" }}
        >
          <i className="bi bi-plus-lg" /> ルール追加
        </button>
      </div>
      {expanded && list.map((r, i) => (
        <div key={i} className="row g-1 mb-1 align-items-center" style={{ fontSize: "0.8rem" }}>
          <div className="col-auto" style={{ width: 120 }}>
            <input
              type="text"
              className="form-control form-control-sm"
              value={r.field}
              onChange={(e) => updateRule(i, { field: e.target.value })}
              placeholder="field"
              style={{ fontSize: "0.8rem" }}
            />
          </div>
          <div className="col-auto" style={{ width: 140 }}>
            <select
              className="form-select form-select-sm"
              value={r.type}
              onChange={(e) => updateRule(i, { type: e.target.value as ValidationRuleType })}
              style={{ fontSize: "0.8rem" }}
            >
              {RULE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          {r.type === "regex" && (
            <div className="col">
              <input
                type="text"
                className="form-control form-control-sm"
                value={r.pattern ?? ""}
                onChange={(e) => updateRule(i, { pattern: e.target.value })}
                placeholder="pattern (例: @conv.regex.email-simple)"
                style={{ fontSize: "0.8rem" }}
              />
            </div>
          )}
          {(r.type === "maxLength" || r.type === "minLength") && (
            <div className="col-auto">
              <input
                type="number"
                className="form-control form-control-sm"
                value={r.length ?? ""}
                onChange={(e) => updateRule(i, { length: Number(e.target.value) })}
                placeholder="length"
                style={{ width: 80, fontSize: "0.8rem" }}
              />
            </div>
          )}
          {r.type === "range" && (
            <>
              <div className="col-auto">
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={r.min ?? ""}
                  onChange={(e) => updateRule(i, { min: Number(e.target.value) })}
                  placeholder="min"
                  style={{ width: 70, fontSize: "0.8rem" }}
                />
              </div>
              <div className="col-auto">
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={r.max ?? ""}
                  onChange={(e) => updateRule(i, { max: Number(e.target.value) })}
                  placeholder="max"
                  style={{ width: 70, fontSize: "0.8rem" }}
                />
              </div>
            </>
          )}
          {r.type === "enum" && (
            <div className="col">
              <input
                type="text"
                className="form-control form-control-sm"
                value={(r.values ?? []).join(",")}
                onChange={(e) => updateRule(i, { values: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })}
                placeholder="values (カンマ区切り、例: credit_card,bank_transfer)"
                style={{ fontSize: "0.8rem" }}
              />
            </div>
          )}
          {r.type === "custom" && (
            <div className="col">
              <ConvCompletionInput
                className="form-control form-control-sm"
                value={r.condition ?? ""}
                onValueChange={(v) => updateRule(i, { condition: v })}
                conventions={conventions ?? null}
                placeholder="condition (例: @items.length >= 1)"
                style={{ fontSize: "0.8rem" }}
              />
            </div>
          )}
          <div className="col-auto" style={{ width: 140 }}>
            <ConvCompletionInput
              className="form-control form-control-sm"
              value={r.message ?? ""}
              onValueChange={(v) => updateRule(i, { message: v || undefined })}
              conventions={conventions ?? null}
              placeholder="message (例: @conv.msg.required)"
              style={{ fontSize: "0.8rem" }}
            />
          </div>
          <div className="col-auto">
            <button
              type="button"
              className="btn btn-sm btn-link text-danger p-0"
              onClick={() => removeRule(i)}
              title="削除"
            >
              <i className="bi bi-x" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
