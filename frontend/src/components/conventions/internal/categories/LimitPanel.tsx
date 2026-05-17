/**
 * LimitPanel — `@conv.limit.*` カタログ編集 panel (#1145 Phase-5)
 */
import { useState } from "react";
import { DeleteBtn, EntriesWrapper, NewKeyRow } from "../SharedRowParts";
import type { LimitEntryLocal } from "../sharedTypes";

export interface LimitPanelProps {
  limit: Record<string, LimitEntryLocal>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<LimitEntryLocal>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}

export function LimitPanel({
  limit, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: LimitPanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(limit);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "8em" }} />
          <col />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.limit.xxx)</th>
            <th>value</th>
            <th>unit</th>
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
                  type="number"
                  className="form-control form-control-sm"
                  value={entry.value}
                  onChange={(e) => onUpdate(key, { value: Number(e.target.value) })}
                  onBlur={onCommit}
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.unit ?? ""}
                  onChange={(e) => onUpdate(key, { unit: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="char"
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
        placeholder="新規 key (例: emailMax)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !limit[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(limit, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
