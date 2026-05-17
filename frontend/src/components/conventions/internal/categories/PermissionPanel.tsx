/**
 * PermissionPanel — `@conv.permission.*` カタログ編集 panel (#1145 Phase-5)
 */
import { useState } from "react";
import { DeleteBtn, EntriesWrapper, NewKeyRow } from "../SharedRowParts";
import { SCOPE_OPTIONS } from "../sharedOptions";
import type { PermissionEntry } from "../../../../types/v3";

export interface PermissionPanelProps {
  permission: Record<string, PermissionEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<PermissionEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}

export function PermissionPanel({
  permission, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: PermissionPanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(permission);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col style={{ width: "12em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "10em" }} />
          <col />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.permission.xxx)</th>
            <th>resource</th>
            <th>action</th>
            <th>scope</th>
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
                  className="form-control form-control-sm"
                  value={entry.resource}
                  onChange={(e) => onUpdate(key, { resource: e.target.value })}
                  onBlur={onCommit}
                  placeholder="Order"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.action}
                  onChange={(e) => onUpdate(key, { action: e.target.value })}
                  onBlur={onCommit}
                  placeholder="create"
                />
              </td>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={entry.scope ?? ""}
                  onChange={(e) => {
                    onUpdate(key, { scope: (e.target.value || undefined) as PermissionEntry["scope"] });
                    onCommit();
                  }}
                >
                  {SCOPE_OPTIONS.map((o) => <option key={o} value={o}>{o || "(未指定)"}</option>)}
                </select>
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
        placeholder="新規 key (例: order.create)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !permission[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(permission, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
