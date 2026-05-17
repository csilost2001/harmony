/**
 * ExternalOutcomeDefaultsPanel — `@conv.externalOutcomeDefaults.*` カタログ編集 panel (#1145 Phase-5)
 */
import { useState } from "react";
import { DeleteBtn, EntriesWrapper, NewKeyRow } from "../SharedRowParts";
import { ACTION_OPTIONS, OUTCOME_OPTIONS, RETRY_OPTIONS } from "../sharedOptions";
import type { ExternalOutcomeEntry } from "../../../../types/v3";

export interface ExternalOutcomeDefaultsPanelProps {
  entries: Record<string, ExternalOutcomeEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<ExternalOutcomeEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}

export function ExternalOutcomeDefaultsPanel({
  entries: entriesMap, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: ExternalOutcomeDefaultsPanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(entriesMap);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "12em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "12em" }} />
          <col />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.externalOutcomeDefaults.xxx)</th>
            <th>outcome</th>
            <th>action</th>
            <th>retry</th>
            <th>description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={entry.outcome}
                  onChange={(e) => { onUpdate(key, { outcome: e.target.value as ExternalOutcomeEntry["outcome"] }); onCommit(); }}
                >
                  {OUTCOME_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={entry.action}
                  onChange={(e) => { onUpdate(key, { action: e.target.value as ExternalOutcomeEntry["action"] }); onCommit(); }}
                >
                  {ACTION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={entry.retry ?? ""}
                  onChange={(e) => {
                    onUpdate(key, { retry: (e.target.value || undefined) as ExternalOutcomeEntry["retry"] });
                    onCommit();
                  }}
                >
                  {RETRY_OPTIONS.map((o) => <option key={o} value={o}>{o || "(未指定)"}</option>)}
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
        placeholder="新規 key (例: failure)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !entriesMap[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(entriesMap, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
