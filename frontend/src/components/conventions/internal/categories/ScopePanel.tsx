/**
 * ScopePanel — `@conv.scope.*` カタログ編集 panel (#1145 Phase-5)
 */
import { useState } from "react";
import { DefaultCell, DeleteBtn, EntriesWrapper, NewKeyRow } from "../SharedRowParts";
import type { ScopeEntry } from "../../../../types/v3";

export interface ScopePanelProps {
  scope: Record<string, ScopeEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<ScopeEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}

export function ScopePanel({
  scope, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: ScopePanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(scope);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col style={{ width: "16em" }} />
          <col />
          <col style={{ width: "5em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.scope.xxx)</th>
            <th>value</th>
            <th>description</th>
            <th title="プロジェクト全体の ambient default として扱う">default</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.value}
                  onChange={(e) => onUpdate(key, { value: e.target.value })}
                  onBlur={onCommit}
                  placeholder="domestic"
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
              <DefaultCell
                entry={entry}
                onUpdate={(patch) => onUpdate(key, patch)}
                onCommit={onCommit}
              />
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: customerRegion)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !scope[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(scope, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
