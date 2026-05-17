/**
 * NumberingPanel — `@conv.numbering.*` カタログ編集 panel (#1145 Phase-5)
 */
import { useState } from "react";
import { DeleteBtn, EntriesWrapper, NewKeyRow } from "../SharedRowParts";
import type { NumberingEntry } from "../../../../types/v3";

export interface NumberingPanelProps {
  numbering: Record<string, NumberingEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<NumberingEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}

export function NumberingPanel({
  numbering, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: NumberingPanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(numbering);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col style={{ width: "14em" }} />
          <col style={{ width: "18em" }} />
          <col />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.numbering.xxx)</th>
            <th>format</th>
            <th>implementation</th>
            <th>description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <input
                  className="form-control form-control-sm conventions-mono"
                  value={entry.format}
                  onChange={(e) => onUpdate(key, { format: e.target.value })}
                  onBlur={onCommit}
                  placeholder="C-NNNN"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.implementation ?? ""}
                  onChange={(e) => onUpdate(key, { implementation: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="PG sequence + DEFAULT"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.description ?? ""}
                  onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                  onBlur={onCommit}
                />
              </td>
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: customerCode)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !numbering[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(numbering, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
