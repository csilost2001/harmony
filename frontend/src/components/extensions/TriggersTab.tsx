import { useState } from "react";
import type { ExtensionTabProps } from "./ExtensionsPanel";

type Row = { value: string; label: string };

function fileOf(bundle: ExtensionTabProps["bundle"]) {
  const raw = bundle.triggers;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as { namespace?: string; triggers?: Row[] };
  return { namespace: "", triggers: [] };
}

export function TriggersTab({ bundle, saving, onSave, isReadonly }: ExtensionTabProps) {
  const file = fileOf(bundle);
  const [namespace, setNamespace] = useState(file.namespace ?? "");
  const [rows, setRows] = useState<Row[]>(Array.isArray(file.triggers) ? file.triggers : []);

  return (
    <div className="extensions-simple-tab">
      <div className="extensions-tab-toolbar">
        <div className="extensions-namespace-field"><label className="form-label small fw-semibold">namespace</label><input className="form-control form-control-sm" value={namespace} onChange={(e) => setNamespace(e.target.value)} disabled={isReadonly} /></div>
        <div className="extensions-toolbar-actions"><button className="btn btn-primary btn-sm" disabled={saving || isReadonly} onClick={() => void onSave("triggers", { namespace, triggers: rows.filter((r) => r.value.trim() && r.label.trim()) })}>保存</button></div>
      </div>
      {rows.length === 0 ? <div className="extensions-empty">トリガーは未登録です。</div> : null}
      {rows.map((row, index) => (
        <div className="extensions-simple-row" key={index}>
          <input className="form-control form-control-sm extensions-mono-input" placeholder="value" value={row.value} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, value: e.target.value } : r))} disabled={isReadonly} />
          <input className="form-control form-control-sm" placeholder="label" value={row.label} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, label: e.target.value } : r))} disabled={isReadonly} />
          <button className="btn btn-outline-danger btn-sm extensions-delete-button" onClick={() => setRows(rows.filter((_, i) => i !== index))} disabled={isReadonly}>削除</button>
        </div>
      ))}
      <div className="extensions-footer-actions">
        <button className="btn btn-outline-primary btn-sm" onClick={() => setRows([...rows, { value: "", label: "" }])} disabled={isReadonly}>追加</button>
      </div>
    </div>
  );
}
