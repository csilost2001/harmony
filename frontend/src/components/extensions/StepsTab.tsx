import { useState } from "react";
import type { ExtensionTabProps } from "./ExtensionsPanel";

type StepEntry = {
  key: string;
  label: string;
  icon: string;
  description: string;
  schemaText: string;
};

function currentFile(bundle: ExtensionTabProps["bundle"]) {
  const raw = bundle.steps;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as { namespace?: string; steps?: Record<string, unknown> };
  return { namespace: "", steps: {} };
}

function entriesFrom(bundle: ExtensionTabProps["bundle"]): StepEntry[] {
  const steps = currentFile(bundle).steps ?? {};
  return Object.entries(steps).map(([key, value]) => {
    const item = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      key,
      label: typeof item.label === "string" ? item.label : key,
      icon: typeof item.icon === "string" ? item.icon : "bi-puzzle",
      description: typeof item.description === "string" ? item.description : "",
      schemaText: JSON.stringify(item.schema ?? { type: "object", properties: {} }, null, 2),
    };
  });
}

export function StepsTab({ bundle, saving, onSave, isReadonly }: ExtensionTabProps) {
  const file = currentFile(bundle);
  const [namespace, setNamespace] = useState(file.namespace ?? "");
  const [rows, setRows] = useState<StepEntry[]>(() => entriesFrom(bundle));
  const [error, setError] = useState<string | null>(null);

  const save = async (nextRows = rows) => {
    try {
      const steps: Record<string, unknown> = {};
      for (const row of nextRows) {
        if (!row.key.trim()) continue;
        steps[row.key.trim()] = {
          label: row.label.trim() || row.key.trim(),
          icon: row.icon.trim() || "bi-puzzle",
          description: row.description,
          schema: JSON.parse(row.schemaText) as unknown,
        };
      }
      setError(null);
      await onSave("steps", { namespace, steps });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="extensions-steps-tab">
      <div className="extensions-tab-toolbar">
        <div className="extensions-namespace-field">
          <label className="form-label small fw-semibold">namespace</label>
          <input className="form-control form-control-sm" value={namespace} onChange={(e) => setNamespace(e.target.value)} disabled={isReadonly} />
        </div>
        <div className="extensions-toolbar-actions">
          <button className="btn btn-primary btn-sm" disabled={saving || isReadonly} onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
      {error ? <div className="alert alert-danger py-2">{error}</div> : null}
      {rows.map((row, index) => (
        <div className="extensions-entry-card" key={index}>
          <div className="extensions-step-grid">
            <input className="form-control form-control-sm extensions-mono-input" placeholder="key" value={row.key} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, key: e.target.value } : r))} disabled={isReadonly} />
            <input className="form-control form-control-sm" placeholder="label" value={row.label} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, label: e.target.value } : r))} disabled={isReadonly} />
            <input className="form-control form-control-sm extensions-mono-input" placeholder="bi-puzzle" value={row.icon} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, icon: e.target.value } : r))} disabled={isReadonly} />
            <input className="form-control form-control-sm" placeholder="description" value={row.description} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, description: e.target.value } : r))} disabled={isReadonly} />
            <button className="btn btn-outline-danger btn-sm extensions-delete-button" onClick={() => setRows(rows.filter((_, i) => i !== index))} disabled={isReadonly}>削除</button>
            <textarea className="form-control form-control-sm font-monospace extensions-json-editor" rows={5} value={row.schemaText} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, schemaText: e.target.value } : r))} disabled={isReadonly} />
          </div>
        </div>
      ))}
      <div className="extensions-footer-actions">
        <button className="btn btn-outline-primary btn-sm" onClick={() => setRows([...rows, { key: "", label: "", icon: "bi-puzzle", description: "", schemaText: '{\n  "type": "object",\n  "properties": {}\n}' }])} disabled={isReadonly}>
          追加
        </button>
      </div>
    </div>
  );
}
