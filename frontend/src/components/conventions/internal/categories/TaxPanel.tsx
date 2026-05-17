/**
 * TaxPanel — `@conv.tax.*` カタログ編集 panel (#1145 Phase-5)
 */
import { useState } from "react";
import { DefaultCell, DeleteBtn, EntriesWrapper, NewKeyRow } from "../SharedRowParts";
import { ROUNDING_OPTIONS } from "../sharedOptions";
import type { TaxEntry } from "../../../../types/v3";

export interface TaxPanelProps {
  tax: Record<string, TaxEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<TaxEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}

export function TaxPanel({
  tax, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: TaxPanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(tax);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "12em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "10em" }} />
          <col />
          <col style={{ width: "5em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.tax.xxx)</th>
            <th>kind</th>
            <th>rate (0〜1)</th>
            <th>roundingMode</th>
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
                <select
                  className="form-select form-select-sm"
                  value={entry.kind}
                  onChange={(e) => { onUpdate(key, { kind: e.target.value as TaxEntry["kind"] }); onCommit(); }}
                >
                  <option value="exclusive">exclusive (外税)</option>
                  <option value="inclusive">inclusive (内税)</option>
                </select>
              </td>
              <td>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={entry.rate}
                  onChange={(e) => onUpdate(key, { rate: Number(e.target.value) })}
                  onBlur={onCommit}
                  step={0.01}
                  min={0}
                  max={1}
                  placeholder="0.10"
                />
              </td>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={entry.roundingMode ?? ""}
                  onChange={(e) => {
                    onUpdate(key, { roundingMode: (e.target.value || undefined) as TaxEntry["roundingMode"] });
                    onCommit();
                  }}
                >
                  {ROUNDING_OPTIONS.map((o) => <option key={o} value={o}>{o || "(未指定)"}</option>)}
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
        placeholder="新規 key (例: standard)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !tax[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(tax, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
