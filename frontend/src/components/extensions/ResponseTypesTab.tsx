import { useState } from "react";
import type { ExtensionTabProps } from "./ExtensionsPanel";

type Row = { key: string; description: string; schemaText: string };

function fileOf(bundle: ExtensionTabProps["bundle"]) {
  const raw = bundle.responseTypes;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as { namespace?: string; responseTypes?: Record<string, unknown> };
  return { namespace: "", responseTypes: {} };
}

function rowsFrom(bundle: ExtensionTabProps["bundle"]): Row[] {
  const responseTypes = fileOf(bundle).responseTypes ?? {};
  return Object.entries(responseTypes).map(([key, value]) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      key,
      description: typeof item.description === "string" ? item.description : "",
      schemaText: JSON.stringify(item.schema ?? { type: "object", properties: {} }, null, 2),
    };
  });
}

export function ResponseTypesTab({ bundle, saving, onSave, isReadonly }: ExtensionTabProps) {
  const file = fileOf(bundle);
  const [namespace, setNamespace] = useState(file.namespace ?? "");
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(bundle));
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    try {
      const responseTypes: Record<string, unknown> = {};
      for (const row of rows) {
        if (!row.key.trim()) continue;
        responseTypes[row.key.trim()] = {
          description: row.description,
          schema: JSON.parse(row.schemaText) as unknown,
        };
      }
      setError(null);
      await onSave("responseTypes", { namespace, responseTypes });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="extensions-response-types-tab">
      <div className="extensions-tab-toolbar">
        <div className="extensions-namespace-field"><label className="form-label small fw-semibold">namespace</label><input className="form-control form-control-sm" value={namespace} onChange={(e) => setNamespace(e.target.value)} disabled={isReadonly} /></div>
        <div className="extensions-toolbar-actions"><button className="btn btn-primary btn-sm" disabled={saving || isReadonly} onClick={() => void save()}>保存</button></div>
      </div>
      {error ? <div className="alert alert-danger py-2">JSON パース失敗: {error}</div> : null}
      {rows.length === 0 ? <div className="extensions-empty">レスポンス型は未登録です。</div> : null}
      {rows.map((row, index) => (
        <div className="extensions-entry-card" key={index}>
          <div className="extensions-response-grid">
            <input className="form-control form-control-sm extensions-mono-input" placeholder="ApiError" value={row.key} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, key: e.target.value } : r))} disabled={isReadonly} />
            <input className="form-control form-control-sm" placeholder="説明" value={row.description} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, description: e.target.value } : r))} disabled={isReadonly} />
            <button className="btn btn-outline-danger btn-sm extensions-delete-button" onClick={() => setRows(rows.filter((_, i) => i !== index))} disabled={isReadonly}>削除</button>
            <textarea className="form-control form-control-sm font-monospace response-type-schema extensions-json-editor" rows={5} value={row.schemaText} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, schemaText: e.target.value } : r))} disabled={isReadonly} />
          </div>
        </div>
      ))}
      <div className="extensions-footer-actions">
        <button className="btn btn-outline-primary btn-sm" onClick={() => setRows([...rows, { key: "", description: "", schemaText: '{\n  "type": "object",\n  "properties": {}\n}' }])} disabled={isReadonly}>
          追加
        </button>
      </div>
    </div>
  );
}
