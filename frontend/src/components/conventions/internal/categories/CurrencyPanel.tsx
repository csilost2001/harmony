/**
 * CurrencyPanel — `@conv.currency.*` カタログ編集 panel (#1145 Phase-5)
 */
import { useState } from "react";
import { DefaultCell, DeleteBtn, EntriesWrapper, NewKeyRow } from "../SharedRowParts";
import { ROUNDING_OPTIONS } from "../sharedOptions";
import type { CurrencyEntry } from "../../../../types/v3";

export interface CurrencyPanelProps {
  currency: Record<string, CurrencyEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<CurrencyEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}

export function CurrencyPanel({
  currency, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: CurrencyPanelProps) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(currency);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "12em" }} />
          <col style={{ width: "7em" }} />
          <col style={{ width: "8em" }} />
          <col style={{ width: "10em" }} />
          <col />
          <col style={{ width: "5em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.currency.xxx)</th>
            <th>code (ISO 4217)</th>
            <th>subunit</th>
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
                <input
                  className="form-control form-control-sm conventions-mono"
                  value={entry.code}
                  onChange={(e) => onUpdate(key, { code: e.target.value })}
                  onBlur={onCommit}
                  placeholder="JPY"
                />
              </td>
              <td>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={entry.subunit ?? ""}
                  onChange={(e) => onUpdate(key, { subunit: e.target.value === "" ? undefined : Number(e.target.value) })}
                  onBlur={onCommit}
                  placeholder="0"
                  min={0}
                />
              </td>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={entry.roundingMode ?? ""}
                  onChange={(e) => {
                    onUpdate(key, { roundingMode: (e.target.value || undefined) as CurrencyEntry["roundingMode"] });
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
        placeholder="新規 key (例: jpy)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !currency[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(currency, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
