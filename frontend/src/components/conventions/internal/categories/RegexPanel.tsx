/**
 * RegexPanel — `@conv.regex.*` カタログ編集 panel (#1145 Phase-5)
 */
import { useState } from "react";
import { DeleteBtn, EntriesWrapper, NewKeyRow } from "../SharedRowParts";
import type { RegexEntryLocal } from "../sharedTypes";

export interface RegexPanelProps {
  regex: Record<string, RegexEntryLocal>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<RegexEntryLocal>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}

export function RegexPanel({
  regex, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: RegexPanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(regex);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col />
          <col style={{ width: "6em" }} />
          <col style={{ width: "18em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.regex.xxx)</th>
            <th>pattern</th>
            <th>flags</th>
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
                  value={entry.pattern}
                  onChange={(e) => onUpdate(key, { pattern: e.target.value })}
                  onBlur={onCommit}
                  placeholder="^[A-Za-z0-9]+$"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm conventions-mono"
                  value={entry.flags ?? ""}
                  onChange={(e) => onUpdate(key, { flags: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="i"
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
        placeholder="新規 key (例: phone-jp)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !regex[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(regex, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
