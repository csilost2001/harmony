/**
 * MsgPanel — `@conv.msg.*` カタログ編集 panel (#1145 Phase-5)
 */
import { useState } from "react";
import { DeleteBtn, EntriesWrapper, NewKeyRow } from "../SharedRowParts";
import type { MsgEntryLocal } from "../sharedTypes";

export interface MsgPanelProps {
  msg: Record<string, MsgEntryLocal>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<MsgEntryLocal>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}

export function MsgPanel({
  msg, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: MsgPanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(msg);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col />
          <col style={{ width: "18em" }} />
          <col style={{ width: "18em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.msg.xxx)</th>
            <th>template</th>
            <th>params (カンマ区切り)</th>
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
                  value={entry.template}
                  onChange={(e) => onUpdate(key, { template: e.target.value })}
                  onBlur={onCommit}
                  placeholder="{label}は必須入力です"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={(entry.params ?? []).join(", ")}
                  onChange={(e) => {
                    const params = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                    onUpdate(key, { params: params.length > 0 ? params : undefined });
                  }}
                  onBlur={onCommit}
                  placeholder="label, max"
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
        placeholder="新規 key (例: required)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !msg[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(msg, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
