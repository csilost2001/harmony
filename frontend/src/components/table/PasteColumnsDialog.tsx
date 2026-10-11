/**
 * 「表から貼り付け」ダイアログ。Excel・スプレッドシートで作ったテーブル定義の表を貼り付けて、
 * カラムをまとめて追加する。読み取りの規則は utils/columnPaste.ts。
 */
import { useEffect, useMemo, useState } from "react";
import { columnUpdates, columnsToTsv, parseColumnTable, splitDuplicates, type ParsedColumn } from "../../utils/columnPaste";
import type { Column } from "../../types/v3/table";
import "../../styles/pasteColumns.css";

interface Props {
  existing: readonly Column[];
  /** 追加するカラムと、(「既にある行も更新する」のとき) 既存カラムの更新 */
  onApply: (add: ParsedColumn[], updates: Array<{ id: string; patch: Partial<Column> }>) => void;
  onClose: () => void;
}

const FLAG = (v?: boolean) => (v ? "○" : "");

export function PasteColumnsDialog({ existing, onApply, onClose }: Props) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(false);
  const copyCurrent = () => {
    navigator.clipboard.writeText(columnsToTsv(existing)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => undefined);
  };
  const parsed = useMemo(() => parseColumnTable(text), [text]);
  const { add, duplicates } = useMemo(() => splitDuplicates(parsed.columns, existing), [parsed.columns, existing]);

  const updates = useMemo(() => (updateExisting ? columnUpdates(duplicates, existing, parsed.fields) : []), [updateExisting, duplicates, existing, parsed.fields]);

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
          <div>
            <button type="button" className="btn btn-sm btn-link p-0" onClick={copyCurrent} data-testid="paste-columns-copy-current">
              <i className="bi bi-clipboard" /> {copied ? "コピーしました" : "いまのカラムを、この形式の表としてコピー (Excel で編集して貼り戻せます。既にある行は「更新する」を選ぶと反映されます)"}
            </button>
          </div>
          <textarea className="paste-cols-text" value={text} onChange={(e) => setText(e.target.value)} rows={7} autoFocus
            placeholder={"例:\n物理名\t表示名\tデータ型\t長さ\tNOT NULL\tPK\ncustomer_id\t顧客ID\tBIGINT\t\t○\t○\ncustomer_name\t顧客名\tVARCHAR\t100\t○\t"}
            spellCheck={false} data-testid="paste-columns-text" />

          {parsed.warnings.length > 0 && (
            <ul className="paste-cols-warnings" data-testid="paste-columns-warnings">
              {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {duplicates.length > 0 && (
            <div className="paste-cols-dup" data-testid="paste-columns-dup">
              <p>既にあるカラムと物理名が同じ行: {duplicates.map((d) => d.physicalName).join("、")}</p>
              <label className="paste-cols-update">
                <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} data-testid="paste-columns-update" />
                {" "}これらも更新する (表にある項目だけを書き換えます。空欄にした項目は空になります)
              </label>
              {updateExisting && (
                <ul data-testid="paste-columns-update-list">
                  {updates.length === 0 && <li>変わるカラムはありません</li>}
                  {updates.map((u) => <li key={u.id}><code>{u.physicalName}</code>: {Object.keys(u.patch).join("、")} を更新</li>)}
                </ul>
              )}
            </div>
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
          <button type="button" className="tbl-btn tbl-btn-primary" disabled={add.length === 0 && updates.length === 0}
            onClick={() => { onApply(add, updates); onClose(); }} data-testid="paste-columns-add">
            {add.length === 0 && updates.length === 0 ? "追加・更新するカラムがありません" : `${add.length > 0 ? `${add.length} 件を追加` : ""}${add.length > 0 && updates.length > 0 ? "、" : ""}${updates.length > 0 ? `${updates.length} 件を更新` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
