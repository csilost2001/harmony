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
    <div>
      <div className="row g-2 align-items-end mb-3">
        <div className="col-md-3"><label className="form-label small fw-semibold">namespace</label><input className="form-control form-control-sm" value={namespace} onChange={(e) => setNamespace(e.target.value)} disabled={isReadonly} /></div>
        <div className="col-md-auto"><button className="btn btn-primary btn-sm" disabled={saving || isReadonly} onClick={() => void onSave("triggers", { namespace, triggers: rows.filter((r) => r.value.trim() && r.label.trim()) })}>保存</button></div>
      </div>
      {rows.map((row, index) => (
        <div className="row g-2 mb-2" key={index}>
          <div className="col-md-4"><input className="form-control form-control-sm" placeholder="value" value={row.value} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, value: e.target.value } : r))} disabled={isReadonly} /></div>
          <div className="col-md-6"><input className="form-control form-control-sm" placeholder="label" value={row.label} onChange={(e) => setRows(rows.map((r, i) => i === index ? { ...r, label: e.target.value } : r))} disabled={isReadonly} /></div>
          <div className="col-md-2 text-end"><button className="btn btn-outline-danger btn-sm" onClick={() => setRows(rows.filter((_, i) => i !== index))} disabled={isReadonly}>削除</button></div>
        </div>
      ))}
      <button className="btn btn-outline-primary btn-sm" onClick={() => setRows([...rows, { value: "", label: "" }])} disabled={isReadonly}>追加</button>
    </div>
  );
}
