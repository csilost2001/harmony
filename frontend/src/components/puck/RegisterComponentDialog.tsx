/**
 * RegisterComponentDialog.tsx
 * Puck カスタムコンポーネント登録ダイアログ
 *
 * - コンポーネント名 (label) / 種類 (primitive) / プロパティ (propsSchema) を入力
 * - 保存時に addCustomPuckComponent を呼び出して workspace に永続化
 *
 * #806 子 5
 */
import { useState } from "react";
import { BUILTIN_PRIMITIVE_NAMES } from "../../puck/buildConfig";
import {
  addCustomPuckComponent,
  type CustomPuckComponentDef,
  type PropSchemaField,
} from "../../store/puckComponentsStore";
import { generateUUID } from "../../utils/uuid";

// ─── 型 ────────────────────────────────────────────────────────────────────────

interface PropRow {
  _rowId: string; // UI 専用の一意キー
  name: string;
  type: PropSchemaField["type"];
  default: string;
  enumOptions: EnumOption[]; // type=enum のとき
  label: string;
}

interface EnumOption {
  _optId: string;
  label: string;
  value: string;
}

interface Props {
  onClose: () => void;
  onSaved?: (def: CustomPuckComponentDef) => void;
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function makeEmptyRow(): PropRow {
  return {
    _rowId: generateUUID(),
    name: "",
    type: "string",
    default: "",
    enumOptions: [],
    label: "",
  };
}

function makeEmptyOption(): EnumOption {
  return { _optId: generateUUID(), label: "", value: "" };
}

function rowsToPropSchema(rows: PropRow[]): Record<string, PropSchemaField> {
  const schema: Record<string, PropSchemaField> = {};
  for (const row of rows) {
    if (!row.name.trim()) continue;
    const field: PropSchemaField = { type: row.type };
    if (row.label.trim()) field.label = row.label.trim();
    if (row.default.trim()) {
      if (row.type === "number") {
        const n = parseFloat(row.default);
        if (!isNaN(n)) field.default = n;
      } else if (row.type === "boolean") {
        field.default = row.default.toLowerCase() === "true";
      } else {
        field.default = row.default;
      }
    }
    if (row.type === "enum" && row.enumOptions.length > 0) {
      field.enum = row.enumOptions
        .filter((o) => o.value.trim())
        .map((o) => ({ label: o.label || o.value, value: o.value }));
    }
    schema[row.name.trim()] = field;
  }
  return schema;
}

// ─── コンポーネント ───────────────────────────────────────────────────────────

export function RegisterComponentDialog({ onClose, onSaved }: Props) {
  const [label, setLabel] = useState("");
  const [primitive, setPrimitive] = useState<string>(BUILTIN_PRIMITIVE_NAMES[0]);
  const [propRows, setPropRows] = useState<PropRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── prop row 操作 ──

  function addPropRow() {
    setPropRows((prev) => [...prev, makeEmptyRow()]);
  }

  function removePropRow(rowId: string) {
    setPropRows((prev) => prev.filter((r) => r._rowId !== rowId));
  }

  function updatePropRow(rowId: string, patch: Partial<PropRow>) {
    setPropRows((prev) =>
      prev.map((r) => (r._rowId === rowId ? { ...r, ...patch } : r))
    );
  }

  // ── enum option 操作 ──

  function addEnumOption(rowId: string) {
    setPropRows((prev) =>
      prev.map((r) =>
        r._rowId === rowId
          ? { ...r, enumOptions: [...r.enumOptions, makeEmptyOption()] }
          : r
      )
    );
  }

  function removeEnumOption(rowId: string, optId: string) {
    setPropRows((prev) =>
      prev.map((r) =>
        r._rowId === rowId
          ? { ...r, enumOptions: r.enumOptions.filter((o) => o._optId !== optId) }
          : r
      )
    );
  }

  function updateEnumOption(rowId: string, optId: string, patch: Partial<EnumOption>) {
    setPropRows((prev) =>
      prev.map((r) =>
        r._rowId === rowId
          ? {
              ...r,
              enumOptions: r.enumOptions.map((o) =>
                o._optId === optId ? { ...o, ...patch } : o
              ),
            }
          : r
      )
    );
  }

  // ── 保存 ──

  async function handleSave() {
    setError(null);

    if (!label.trim()) {
      setError("コンポーネント名は必須です。");
      return;
    }

    // プロパティ名の検証
    for (const row of propRows) {
      if (!row.name.trim()) continue;
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(row.name.trim())) {
        setError(`プロパティ名 "${row.name}" は英数字・アンダースコアのみ使用できます。`);
        return;
      }
    }

    const def: CustomPuckComponentDef = {
      id: generateUUID(),
      label: label.trim(),
      primitive,
      propsSchema: rowsToPropSchema(propRows),
    };

    setSaving(true);
    try {
      await addCustomPuckComponent(def);
      onSaved?.(def);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  }

  // ── render ──

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 8,
          padding: 24,
          minWidth: 480,
          maxWidth: 640,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
        }}
      >
        <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 18 }}>
          新規カスタムコンポーネント
        </h2>

        {/* コンポーネント名 */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ display: "block", fontWeight: "bold", marginBottom: 4 }}>
            コンポーネント名 <span style={{ color: "red" }}>*</span>
          </label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="例: 検索バー"
            style={{ width: "100%", padding: "6px 8px", boxSizing: "border-box" }}
          />
        </div>

        {/* 種類 */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontWeight: "bold", marginBottom: 4 }}>
            ベース種類 (primitive) <span style={{ color: "red" }}>*</span>
          </label>
          <select
            value={primitive}
            onChange={(e) => setPrimitive(e.target.value)}
            style={{ width: "100%", padding: "6px 8px" }}
          >
            {BUILTIN_PRIMITIVE_NAMES.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        {/* プロパティ定義 */}
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <span style={{ fontWeight: "bold" }}>プロパティ</span>
            <button
              type="button"
              onClick={addPropRow}
              style={{
                fontSize: 12,
                padding: "4px 10px",
                cursor: "pointer",
                background: "#0070f3",
                color: "#fff",
                border: "none",
                borderRadius: 4,
              }}
            >
              + 追加
            </button>
          </div>

          {propRows.length === 0 && (
            <p style={{ color: "#888", fontSize: 13, margin: 0 }}>
              プロパティを追加するには「+ 追加」をクリックしてください。
            </p>
          )}

          {propRows.map((row) => (
            <PropRowEditor
              key={row._rowId}
              row={row}
              onChange={(patch) => updatePropRow(row._rowId, patch)}
              onRemove={() => removePropRow(row._rowId)}
              onAddEnumOption={() => addEnumOption(row._rowId)}
              onRemoveEnumOption={(optId) => removeEnumOption(row._rowId, optId)}
              onUpdateEnumOption={(optId, patch) =>
                updateEnumOption(row._rowId, optId, patch)
              }
            />
          ))}
        </div>

        {/* エラー */}
        {error && (
          <p style={{ color: "red", fontSize: 13, marginBottom: 12 }}>{error}</p>
        )}

        {/* ボタン */}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{ padding: "8px 16px", cursor: "pointer" }}
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            style={{
              padding: "8px 16px",
              cursor: saving ? "not-allowed" : "pointer",
              background: "#0070f3",
              color: "#fff",
              border: "none",
              borderRadius: 4,
            }}
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── PropRowEditor ────────────────────────────────────────────────────────────

interface PropRowEditorProps {
  row: PropRow;
  onChange: (patch: Partial<PropRow>) => void;
  onRemove: () => void;
  onAddEnumOption: () => void;
  onRemoveEnumOption: (optId: string) => void;
  onUpdateEnumOption: (optId: string, patch: Partial<EnumOption>) => void;
}

function PropRowEditor({
  row,
  onChange,
  onRemove,
  onAddEnumOption,
  onRemoveEnumOption,
  onUpdateEnumOption,
}: PropRowEditorProps) {
  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderRadius: 6,
        padding: 12,
        marginBottom: 8,
        background: "#f9f9f9",
      }}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-end" }}>
        {/* 名前 */}
        <div style={{ flex: 2 }}>
          <label style={{ display: "block", fontSize: 12, marginBottom: 2 }}>
            名前 (英数字)
          </label>
          <input
            type="text"
            value={row.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="propName"
            style={{ width: "100%", padding: "4px 6px", boxSizing: "border-box" }}
          />
        </div>
        {/* 型 */}
        <div style={{ flex: 1 }}>
          <label style={{ display: "block", fontSize: 12, marginBottom: 2 }}>型</label>
          <select
            value={row.type}
            onChange={(e) =>
              onChange({ type: e.target.value as PropSchemaField["type"] })
            }
            style={{ width: "100%", padding: "4px 6px" }}
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="enum">enum</option>
          </select>
        </div>
        {/* default */}
        <div style={{ flex: 2 }}>
          <label style={{ display: "block", fontSize: 12, marginBottom: 2 }}>
            デフォルト値
          </label>
          <input
            type="text"
            value={row.default}
            onChange={(e) => onChange({ default: e.target.value })}
            placeholder="(空でも可)"
            style={{ width: "100%", padding: "4px 6px", boxSizing: "border-box" }}
          />
        </div>
        {/* 削除 */}
        <button
          type="button"
          onClick={onRemove}
          title="このプロパティを削除"
          style={{
            background: "transparent",
            border: "none",
            color: "#c00",
            fontSize: 16,
            cursor: "pointer",
            padding: "4px 6px",
          }}
        >
          ✕
        </button>
      </div>

      {/* ラベル (任意) */}
      <div style={{ marginBottom: row.type === "enum" ? 8 : 0 }}>
        <label style={{ display: "block", fontSize: 12, marginBottom: 2 }}>
          表示ラベル (任意)
        </label>
        <input
          type="text"
          value={row.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="プロパティの表示名"
          style={{ width: "100%", padding: "4px 6px", boxSizing: "border-box" }}
        />
      </div>

      {/* enum options */}
      {row.type === "enum" && (
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: "bold" }}>enum オプション</span>
            <button
              type="button"
              onClick={onAddEnumOption}
              style={{
                fontSize: 11,
                padding: "2px 8px",
                cursor: "pointer",
                background: "#555",
                color: "#fff",
                border: "none",
                borderRadius: 3,
              }}
            >
              + オプション追加
            </button>
          </div>
          {row.enumOptions.map((opt) => (
            <div
              key={opt._optId}
              style={{ display: "flex", gap: 6, marginBottom: 4, alignItems: "center" }}
            >
              <input
                type="text"
                value={opt.label}
                onChange={(e) => onUpdateEnumOption(opt._optId, { label: e.target.value })}
                placeholder="ラベル"
                style={{ flex: 1, padding: "3px 5px" }}
              />
              <span style={{ fontSize: 11, color: "#888" }}>=</span>
              <input
                type="text"
                value={opt.value}
                onChange={(e) => onUpdateEnumOption(opt._optId, { value: e.target.value })}
                placeholder="値"
                style={{ flex: 1, padding: "3px 5px" }}
              />
              <button
                type="button"
                onClick={() => onRemoveEnumOption(opt._optId)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#c00",
                  cursor: "pointer",
                  fontSize: 13,
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
