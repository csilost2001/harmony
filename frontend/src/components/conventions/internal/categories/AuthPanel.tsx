/**
 * AuthPanel — `@conv.auth.*` カタログ編集 panel (#1145 Phase-5)
 */
import { useState } from "react";
import { DefaultCell, DeleteBtn, EntriesWrapper, NewKeyRow } from "../SharedRowParts";
import type { AuthEntry } from "../../../../types/v3";

export interface AuthPanelProps {
  auth: Record<string, AuthEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<AuthEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}

export function AuthPanel({
  auth, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: AuthPanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(auth);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "12em" }} />
          <col style={{ width: "14em" }} />
          <col style={{ width: "14em" }} />
          <col style={{ width: "14em" }} />
          <col />
          <col style={{ width: "5em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.auth.xxx)</th>
            <th>scheme</th>
            <th>sessionStorage</th>
            <th>passwordHash</th>
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
                  value={entry.scheme}
                  onChange={(e) => onUpdate(key, { scheme: e.target.value })}
                  onBlur={onCommit}
                  placeholder="session-cookie"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.sessionStorage ?? ""}
                  onChange={(e) => onUpdate(key, { sessionStorage: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="httpOnly-cookie"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.passwordHash ?? ""}
                  onChange={(e) => onUpdate(key, { passwordHash: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="bcrypt(cost=12)"
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
        placeholder="新規 key (例: default)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !auth[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(auth, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
