import { useState } from "react";
import type {
  ActionFields,
  FieldType,
  FieldTypeDomain,
  FieldTypeExtension,
  Identifier,
  ScreenId,
  StructuredField,
} from "../../types/v3";
import { fieldsToText, isStructuredFields, textToStructuredFields } from "../../utils/actionFields";

/** 画面項目ピッカーで返る型 — StructuredField にコピー元の値を載せて返す */
export interface ScreenItemPickResult {
  screenId: string;
  itemId: string;
  /** ScreenItem から派生した StructuredField フィールド値 */
  name: string;
  label?: string;
  type: FieldType;
  required?: boolean;
  description?: string;
}

interface Props {
  label: string;
  fields: ActionFields | undefined;
  onChange: (fields: ActionFields | undefined) => void;
  onCommit?: () => void;
  placeholder?: string;
  /**
   * 「画面項目から追加」ボタンから呼ばれるピッカー (#321)。親 (ProcessFlowEditor) が
   * モーダルを開いてユーザー選択を返す。undefined ならボタン非表示。
   */
  onPickScreenItem?: () => Promise<ScreenItemPickResult | null>;
}

const PRIMITIVE_TYPES: Array<"string" | "number" | "boolean" | "date"> = ["string", "number", "boolean", "date"];

/** FieldType オブジェクトをテキスト入力の表示値に変換する */
function fieldTypeToDisplay(type: FieldType): string {
  if (typeof type === "string") return type;
  // legacy `kind: "custom"` (v3 非規範、既存データ互換)
  const t = type as { kind: string; domainKey?: string; extensionRef?: string; label?: string };
  switch (t.kind) {
    case "domain":    return `domain:${t.domainKey ?? ""}`;
    case "extension": return `ext:${t.extensionRef ?? ""}`;
    case "custom":    return t.label ?? "";
    default:          return t.kind;
  }
}

/** テキスト入力値から FieldType に変換する */
function displayToFieldType(v: string): FieldType {
  if (v === "") return "string";
  if ((PRIMITIVE_TYPES as string[]).includes(v)) return v as FieldType;
  if (v.startsWith("domain:")) {
    const domainKey = v.slice("domain:".length).trim();
    return { kind: "domain", domainKey: domainKey || v } satisfies FieldTypeDomain;
  }
  if (v.startsWith("ext:")) {
    const extensionRef = v.slice("ext:".length).trim();
    return { kind: "extension", extensionRef: extensionRef || v } satisfies FieldTypeExtension;
  }
  // fallback: plain text → domain (PascalCase) or keep as custom-compat
  return { kind: "domain", domainKey: v } satisfies FieldTypeDomain;
}

/** FieldType オブジェクトのツールチップ表示 */
function fieldTypeTitle(type: FieldType): string | undefined {
  if (typeof type === "string") return undefined;
  const t = type as { kind: string; domainKey?: string; extensionRef?: string; label?: string };
  switch (t.kind) {
    case "domain":    return `ドメイン型: ${t.domainKey}`;
    case "extension": return `拡張型: ${t.extensionRef}`;
    case "custom":    return `カスタム型: ${t.label}`;  // legacy 互換
    default:          return t.kind;
  }
}

/**
 * ActionDefinition.inputs / outputs の編集 UI (#226 / #310)。
 * 自由記述モード (textarea) と表形式モード (StructuredField[]) を切替可能。
 * 表形式では 1 項目 1 行の <table> で name / label / type / required / description を編集。
 * FieldType は primitive + custom のみ対応、tableRow/tableList/screenInput は将来。
 */
export function StructuredFieldsEditor({ label, fields, onChange, onCommit, placeholder, onPickScreenItem }: Props) {
  const isStructured = isStructuredFields(fields);
  const [mode, setMode] = useState<"text" | "table">(isStructured ? "table" : "text");

  const switchToTable = () => {
    if (!isStructured) {
      const text = typeof fields === "string" ? fields : "";
      onChange(textToStructuredFields(text));
    }
    setMode("table");
  };

  const switchToText = () => {
    if (isStructured) {
      onChange(fieldsToText(fields));
    }
    setMode("text");
  };

  const addField = () => {
    const curr = isStructured ? fields : [];
    const newField: StructuredField = { name: "" as Identifier, type: "string" };
    onChange([...curr, newField]);
  };

  /** 画面項目ピッカー経由で新規フィールド追加 (#321) */
  const addFieldFromScreenItem = async () => {
    if (!onPickScreenItem) return;
    const result = await onPickScreenItem();
    if (!result) return;
    const curr = isStructured ? fields : [];
    const newField: StructuredField = {
      name: result.name as Identifier,
      label: result.label,
      type: result.type,
      required: result.required,
      description: result.description,
      screenItemRef: { screenId: result.screenId as ScreenId, itemId: result.itemId as Identifier },
    };
    onChange([...curr, newField]);
    onCommit?.();
  };

  /** 既存フィールドの screenItemRef を解除 (フィールド自体は残す) */
  const unlinkScreenItem = (idx: number) => {
    if (!isStructured) return;
    const next = fields.map((f, i) => {
      if (i !== idx) return f;
      const { screenItemRef: _screenItemRef, ...rest } = f;
      return rest as StructuredField;
    });
    onChange(next);
    onCommit?.();
  };

  const updateField = (idx: number, patch: Partial<StructuredField>) => {
    if (!isStructured) return;
    const next = fields.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    onChange(next);
  };

  const removeField = (idx: number) => {
    if (!isStructured) return;
    const next = fields.filter((_, i) => i !== idx);
    onChange(next.length > 0 ? next : undefined);
  };

  return (
    <div className="structured-fields-editor">
      <div className="structured-fields-header">
        <label className="form-label mb-0">{label}</label>
        <div className="btn-group btn-group-sm" role="group" aria-label="表示モード">
          <button
            type="button"
            className={`btn btn-outline-secondary${mode === "text" ? " active" : ""}`}
            onClick={switchToText}
            title="自由記述モード (改行区切り)"
          >
            <i className="bi bi-text-paragraph" />
          </button>
          <button
            type="button"
            className={`btn btn-outline-secondary${mode === "table" ? " active" : ""}`}
            onClick={switchToTable}
            title="表形式モード (構造化)"
          >
            <i className="bi bi-table" />
          </button>
        </div>
      </div>

      {mode === "text" ? (
        <textarea
          className="form-control form-control-sm"
          rows={2}
          value={fieldsToText(fields)}
          onChange={(e) => onChange(e.target.value || undefined)}
          onBlur={() => onCommit?.()}
          placeholder={placeholder}
        />
      ) : (
        <div className="structured-fields-body">
          <table className="structured-fields-table">
            <colgroup>
              <col className="col-no" />
              <col className="col-name" />
              <col className="col-label" />
              <col className="col-type" />
              <col className="col-required" />
              <col className="col-desc" />
              <col className="col-actions" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">名前</th>
                <th scope="col">日本語名</th>
                <th scope="col">型</th>
                <th scope="col" className="text-center">必須</th>
                <th scope="col">説明</th>
                <th scope="col" aria-label="操作" />
              </tr>
            </thead>
            <tbody>
              {isStructured && fields.length === 0 && (
                <tr>
                  <td colSpan={7} className="structured-fields-empty">フィールドなし</td>
                </tr>
              )}
              {isStructured && fields.map((f, i) => (
                <tr key={i} className={f.screenItemRef ? "structured-fields-linked-row" : undefined}>
                  <td className="structured-fields-no">
                    {i + 1}
                    {f.screenItemRef && (
                      <i
                        className="bi bi-link-45deg structured-fields-link-badge"
                        title={`画面項目参照中: ${f.screenItemRef.screenId} / ${f.screenItemRef.itemId}`}
                      />
                    )}
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={f.name}
                      onChange={(e) => updateField(i, { name: e.target.value as Identifier })}
                      onBlur={() => onCommit?.()}
                      placeholder="name"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={f.label ?? ""}
                      onChange={(e) => updateField(i, { label: e.target.value || undefined })}
                      onBlur={() => onCommit?.()}
                      placeholder="label"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      list="structured-fields-type-list"
                      className="form-control form-control-sm"
                      value={fieldTypeToDisplay(f.type)}
                      onChange={(e) => updateField(i, { type: displayToFieldType(e.target.value) })}
                      onBlur={() => onCommit?.()}
                      placeholder="型 (string / domain:Name / ext:ns:key)"
                      title={fieldTypeTitle(f.type)}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      className="form-check-input structured-fields-required"
                      checked={!!f.required}
                      onChange={(e) => updateField(i, { required: e.target.checked || undefined })}
                      aria-label="必須"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      value={f.description ?? ""}
                      onChange={(e) => updateField(i, { description: e.target.value || undefined })}
                      onBlur={() => onCommit?.()}
                      placeholder="description"
                      title={f.description ?? ""}
                    />
                  </td>
                  <td className="text-center">
                    {f.screenItemRef && (
                      <button
                        type="button"
                        className="btn btn-sm btn-link p-0 me-1 structured-fields-unlink"
                        onClick={() => unlinkScreenItem(i)}
                        title="画面項目参照を解除 (フィールド自体は残す)"
                        aria-label="参照解除"
                      >
                        <i className="bi bi-link-45deg" style={{ textDecoration: "line-through" }} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm btn-link text-danger p-0 structured-fields-delete"
                      onClick={() => removeField(i)}
                      title="削除"
                      aria-label="削除"
                    >
                      <i className="bi bi-x" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary structured-fields-add"
            onClick={() => { addField(); onCommit?.(); }}
          >
            <i className="bi bi-plus-lg" /> フィールド追加
          </button>
          {onPickScreenItem && (
            <button
              type="button"
              className="btn btn-sm btn-outline-primary structured-fields-add ms-2"
              onClick={addFieldFromScreenItem}
              title="画面項目定義から選択して追加 (#321)"
            >
              <i className="bi bi-ui-checks-grid me-1" /> 画面項目から追加
            </button>
          )}
          {/* 型入力の候補 (primitive のみ提示、自由入力も可) — 全 row 共有 */}
          <datalist id="structured-fields-type-list">
            {PRIMITIVE_TYPES.map((t) => <option key={t} value={t} />)}
          </datalist>
        </div>
      )}
    </div>
  );
}
