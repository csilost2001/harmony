/**
 * 「表から貼り付け」ダイアログ。Excel・スプレッドシートで作ったテーブル定義の表を貼り付けて、
 * カラムをまとめて追加する。読み取りの規則は utils/columnPaste.ts。
 */
import { useEffect, useMemo, useState } from "react";
import { parseColumnTable, splitDuplicates, type ParsedColumn } from "../../utils/columnPaste";
import type { Column } from "../../types/v3/table";
import "../../styles/pasteColumns.css";

interface Props {
  existing: readonly Pick<Column, "physicalName">[];
  onAdd: (columns: ParsedColumn[]) => void;
  onClose: () => void;
}

const FLAG = (v?: boolean) => (v ? "○" : "");

export function PasteColumnsDialog({ existing, onAdd, onClose }: Props) {
  const [text, setText] = useState("");
  const parsed = useMemo(() => parseColumnTable(text), [text]);
  const { add, duplicates } = useMemo(() => splitDuplicates(parsed.columns, existing), [parsed.columns, existing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="paste-cols-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="paste-cols-modal" role="dialog" aria-modal="true" aria-label="表から貼り付け" data-testid="paste-columns-dialog">
        <div className="paste-cols-head">
          <h2><i className="bi bi-clipboard-data" /> 表から貼り付けてカラムを追加</h2>
          <button type="button" className="paste-cols-close" aria-label="閉じる" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="paste-cols-body">
          <p className="paste-cols-help">
            Excel などの表 (タブ区切り・カンマ区切り) を貼り付けます。1 行目が見出し (物理名・表示名・データ型・長さ・NOT NULL・PK・UK・連番・デフォルト・備考) なら、列の順は自由です。
            見出しがなければ、この順に並んでいるものとして読みます。型は <code>VARCHAR(100)</code> や <code>int</code>・<code>文字列</code> のような書き方も読めます。
          </p>
          <textarea className="paste-cols-text" value={text} onChange={(e) => setText(e.target.value)} rows={7} autoFocus
            placeholder={"例:\n物理名\t表示名\tデータ型\t長さ\tNOT NULL\tPK\ncustomer_id\t顧客ID\tBIGINT\t\t○\t○\ncustomer_name\t顧客名\tVARCHAR\t100\t○\t"}
            spellCheck={false} data-testid="paste-columns-text" />

          {parsed.warnings.length > 0 && (
            <ul className="paste-cols-warnings" data-testid="paste-columns-warnings">
              {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {duplicates.length > 0 && (
            <p className="paste-cols-dup" data-testid="paste-columns-dup">
              既にあるカラムと物理名が同じため、追加しません: {duplicates.map((d) => d.physicalName).join("、")}
            </p>
          )}

          {add.length > 0 && (
            <div className="paste-cols-preview" data-testid="paste-columns-preview">
              <table>
                <thead><tr><th>物理名</th><th>表示名</th><th>データ型</th><th>長さ</th><th>NN</th><th>PK</th><th>UK</th><th>AI</th><th>デフォルト</th><th>備考</th></tr></thead>
                <tbody>
                  {add.map((c) => (
                    <tr key={c.physicalName}>
                      <td><code>{c.physicalName}</code></td><td>{c.name}</td><td>{c.dataType}</td>
                      <td>{c.length !== undefined ? (c.scale !== undefined ? `${c.length},${c.scale}` : c.length) : ""}</td>
                      <td>{FLAG(c.notNull)}</td><td>{FLAG(c.primaryKey)}</td><td>{FLAG(c.unique)}</td><td>{FLAG(c.autoIncrement)}</td>
                      <td>{c.defaultValue}</td><td>{c.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="paste-cols-foot">
          <button type="button" className="tbl-btn tbl-btn-ghost" onClick={onClose}>キャンセル</button>
          <button type="button" className="tbl-btn tbl-btn-primary" disabled={add.length === 0}
            onClick={() => { onAdd(add); onClose(); }} data-testid="paste-columns-add">
            {add.length > 0 ? `${add.length} 件のカラムを追加` : "追加するカラムがありません"}
          </button>
        </div>
      </div>
    </div>
  );
}
