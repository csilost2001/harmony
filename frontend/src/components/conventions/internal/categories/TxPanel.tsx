/**
 * TxPanel — `@conv.tx.*` カタログ編集 panel (#1145 Phase-5)
 */
import { useState } from "react";
import { DeleteBtn, EntriesWrapper, NewKeyRow } from "../SharedRowParts";
import type { TxEntry } from "../../../../types/v3";

export interface TxPanelProps {
  tx: Record<string, TxEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<TxEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}

export function TxPanel({
  tx, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: TxPanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(tx);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col />
          <col style={{ width: "18em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.tx.xxx)</th>
            <th>policy</th>
            <th>description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <textarea
                  className="form-control form-control-sm conventions-table-textarea"
                  value={entry.policy}
                  onChange={(e) => onUpdate(key, { policy: e.target.value })}
                  onBlur={onCommit}
                  rows={2}
                  placeholder="単一操作は 1 TX..."
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
        placeholder="新規 key (例: singleOperation)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !tx[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(tx, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
