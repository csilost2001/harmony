/**
 * DbPanel — `@conv.db.*` カタログ編集 panel (#1145 Phase-5)
 */
import { useState } from "react";
import { DefaultCell, DeleteBtn, EntriesWrapper, NewKeyRow } from "../SharedRowParts";
import type { DbEntry } from "../../../../types/v3";

export interface DbPanelProps {
  db: Record<string, DbEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<DbEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}

export function DbPanel({
  db, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: DbPanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(db);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "12em" }} />
          <col style={{ width: "12em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "16em" }} />
          <col style={{ width: "12em" }} />
          <col />
          <col style={{ width: "5em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.db.xxx)</th>
            <th>engine</th>
            <th>namingConvention</th>
            <th>timestampColumns (カンマ区切り)</th>
            <th>logicalDeleteColumn</th>
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
                  value={entry.engine ?? ""}
                  onChange={(e) => onUpdate(key, { engine: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="postgresql@14"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.namingConvention ?? ""}
                  onChange={(e) => onUpdate(key, { namingConvention: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="snake_case"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={(entry.timestampColumns ?? []).join(", ")}
                  onChange={(e) => {
                    const cols = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                    onUpdate(key, { timestampColumns: cols.length > 0 ? cols : undefined });
                  }}
                  onBlur={onCommit}
                  placeholder="created_at, updated_at"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.logicalDeleteColumn ?? ""}
                  onChange={(e) => onUpdate(key, { logicalDeleteColumn: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="is_deleted"
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
        onAdd={() => { const k = newKey.trim(); if (k && !db[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(db, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
