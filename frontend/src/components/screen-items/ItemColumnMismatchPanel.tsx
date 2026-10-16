/**
 * 画面項目とカラムの食い違い (UI 改善提案 続編 第 8 弾 #156)。紐づけたカラムと比べて、型・最大長・必須が違う項目を、表で並べ、
 * 行ごと・まとめて「項目をカラムに合わせる」。カラムは別の設計なので、直すのは項目のほうだけ。Ctrl+Z で戻せる。
 */
import { useMemo, useState } from "react";
import type { ScreenItem, Table } from "../../types/v3";
import "../../styles/columnImpact.css";
import { fixPatch, itemColumnMismatches } from "../../utils/itemColumnMismatch";

interface Props {
  items: readonly ScreenItem[];
  tables: readonly Table[];
  readOnly: boolean;
  /** 合わせる変更 (項目 ID と変更) をまとめて適用する */
  onApply: (updates: Array<{ id: string; patch: Partial<ScreenItem> }>) => void;
}

export function ItemColumnMismatchPanel({ items, tables, readOnly, onApply }: Props) {
  const rows = useMemo(() => itemColumnMismatches(items, tables), [items, tables]);
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const fixable = rows.filter((r) => Object.keys(fixPatch(r)).length > 0);
  return (
    <div className="icm" data-testid="item-column-mismatch">
      <button type="button" className="btn btn-sm btn-outline-warning" aria-expanded={open} onClick={() => setOpen((v) => !v)} data-testid="icm-toggle">
        <i className="bi bi-exclamation-triangle me-1" /> カラムとの食い違い ({rows.length} 件)
      </button>
      {open && (
        <div className="icm-body">
          <table className="icm-table">
            <thead><tr><th>項目</th><th>カラム</th><th>食い違い</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.itemId} data-testid="icm-row">
                  <td>{r.label} <code>{r.itemId}</code></td>
                  <td>{r.tableName} / {r.columnName}</td>
                  <td><ul>{r.mismatches.map((m, i) => <li key={i}>{m.message}</li>)}</ul></td>
                  <td>{Object.keys(fixPatch(r)).length > 0 && <button type="button" className="btn btn-sm btn-outline-secondary" disabled={readOnly} onClick={() => onApply([{ id: r.itemId, patch: fixPatch(r) }])} data-testid="icm-fix">カラムに合わせる</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="btn btn-sm btn-primary" disabled={readOnly || fixable.length === 0} onClick={() => onApply(fixable.map((r) => ({ id: r.itemId, patch: fixPatch(r) })))} data-testid="icm-fix-all">
            直せるものをすべて、カラムに合わせる ({fixable.length} 件)
          </button>
          {readOnly && <span className="icm-note"> 編集を始めると、直せます。</span>}
        </div>
      )}
    </div>
  );
}
