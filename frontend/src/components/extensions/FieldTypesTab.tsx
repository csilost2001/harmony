import { useState } from "react";
import type { ExtensionTabProps } from "./ExtensionsPanel";

type Row = { kind: string; label: string };

function fileOf(bundle: ExtensionTabProps["bundle"]) {
  const raw = bundle.fieldTypes;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as { namespace?: string; fieldTypes?: Row[] };
  return { namespace: "", fieldTypes: [] };
}

export function FieldTypesTab({ bundle, saving, onSave, isReadonly }: ExtensionTabProps) {
  const file = fileOf(bundle);
  const [namespace, setNamespace] = useState(file.namespace ?? "");
  const [rows, setRows] = useState<Row[]>(Array.isArray(file.fieldTypes) ? file.fieldTypes : []);

  return (
    <SimpleRows
      title="フィールド型"
      keyName="kind"
      namespace={namespace}
      rows={rows}
      saving={saving}
      isReadonly={isReadonly}
      onNamespaceChange={setNamespace}
      onRowsChange={setRows}
      onSave={() => onSave("fieldTypes", { namespace, fieldTypes: rows.filter((r) => r.kind.trim() && r.label.trim()) })}
    />
  );
}

function SimpleRows({
  title, keyName, namespace, rows, saving, isReadonly, onNamespaceChange, onRowsChange, onSave,
}: {
  title: string;
  keyName: "kind" | "value";
  namespace: string;
  rows: Row[];
  saving: boolean;
  isReadonly?: boolean;
  onNamespaceChange: (v: string) => void;
  onRowsChange: (rows: Row[]) => void;
  onSave: () => Promise<void>;
}) {
  return (
    <div className="extensions-simple-tab">
      <div className="extensions-tab-toolbar">
        <div className="extensions-namespace-field"><label className="form-label small fw-semibold">namespace</label><input className="form-control form-control-sm" value={namespace} onChange={(e) => onNamespaceChange(e.target.value)} disabled={isReadonly} /></div>
        <div className="extensions-toolbar-actions"><button className="btn btn-primary btn-sm" disabled={saving || isReadonly} onClick={() => void onSave()}>保存</button></div>
      </div>
      {rows.length === 0 ? <div className="extensions-empty">{title} は未登録です。</div> : null}
      {rows.map((row, index) => (
        <div className="extensions-simple-row" key={index}>
          <input className="form-control form-control-sm extensions-mono-input" placeholder={keyName} value={row.kind} onChange={(e) => onRowsChange(rows.map((r, i) => i === index ? { ...r, kind: e.target.value } : r))} disabled={isReadonly} />
          <input className="form-control form-control-sm" placeholder="label" value={row.label} onChange={(e) => onRowsChange(rows.map((r, i) => i === index ? { ...r, label: e.target.value } : r))} disabled={isReadonly} />
          <button className="btn btn-outline-danger btn-sm extensions-delete-button" onClick={() => onRowsChange(rows.filter((_, i) => i !== index))} disabled={isReadonly}>削除</button>
        </div>
      ))}
      <div className="extensions-footer-actions">
        <button className="btn btn-outline-primary btn-sm" onClick={() => onRowsChange([...rows, { kind: "", label: "" }])} disabled={isReadonly}>追加</button>
      </div>
    </div>
  );
}
