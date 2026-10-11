/**
 * 「表から貼り付け」ダイアログ (画面項目)。Excel・スプレッドシートで作った項目定義の表を貼り付けて、
 * 画面項目をまとめて追加する。読み取りの規則は utils/itemPaste.ts。
 */
import { useEffect, useMemo, useState } from "react";
import { itemUpdates, itemsToTsv, parseItemTable, splitDuplicateItems, type ParsedItem } from "../../utils/itemPaste";
import type { ScreenItem } from "../../types/v3/screen-item";
import "../../styles/pasteColumns.css";

interface Props {
  existing: readonly ScreenItem[];
  /** 追加する項目と、(「既にある行も更新する」のとき) 既存項目の更新 */
  onApply: (add: ParsedItem[], updates: Array<{ id: string; patch: Partial<ScreenItem> }>) => void;
  onClose: () => void;
}

const DIRECTION_LABEL: Record<string, string> = { in: "入力", out: "出力", both: "入出力" };

export function PasteItemsDialog({ existing, onApply, onClose }: Props) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [updateExisting, setUpdateExisting] = useState(false);
  const copyCurrent = () => {
    navigator.clipboard.writeText(itemsToTsv(existing)).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => undefined);
  };
  const parsed = useMemo(() => parseItemTable(text), [text]);
  const { add, duplicates } = useMemo(() => splitDuplicateItems(parsed.items, existing), [parsed.items, existing]);

  const updates = useMemo(() => (updateExisting ? itemUpdates(duplicates, existing, parsed.fields) : []), [updateExisting, duplicates, existing, parsed.fields]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="paste-cols-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="paste-cols-modal" role="dialog" aria-modal="true" aria-label="表から貼り付け" data-testid="paste-items-dialog">
        <div className="paste-cols-head">
          <h2><i className="bi bi-clipboard-data" /> 表から貼り付けて画面項目を追加</h2>
          <button type="button" className="paste-cols-close" aria-label="閉じる" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="paste-cols-body">
          <p className="paste-cols-help">
            Excel などの項目定義の表 (タブ区切り・カンマ区切り) を貼り付けます。1 行目が見出し (項目 ID・ラベル・型・入出力・必須・最大長・最小長・最小値・最大値・パターン・説明) なら、列の順は自由です。
            見出しがなければ、項目 ID・ラベル・型・入出力・必須・最大長・最小長・パターン・説明 の順に並んでいるものとして読みます。
            項目 ID は英字で始まる英数字 (<code>customer_name</code> は <code>customerName</code> に直します)、型は 文字列・整数・数値・真偽・日付・日時 などの書き方も読めます。
          </p>
          <div>
            <button type="button" className="btn btn-sm btn-link p-0" onClick={copyCurrent} data-testid="paste-items-copy-current">
              <i className="bi bi-clipboard" /> {copied ? "コピーしました" : "いまの項目を、この形式の表としてコピー (Excel で編集して貼り戻せます。既にある行は「更新する」を選ぶと反映されます)"}
            </button>
          </div>
          <textarea className="paste-cols-text" value={text} onChange={(e) => setText(e.target.value)} rows={7} autoFocus
            placeholder={"例:\n項目ID\tラベル\t型\t入出力\t必須\t最大長\ncustomerName\t顧客名\t文字列\t入力\t○\t100\nbirthDate\t生年月日\t日付\t入力\t\t"}
            spellCheck={false} data-testid="paste-items-text" />

          {parsed.warnings.length > 0 && (
            <ul className="paste-cols-warnings" data-testid="paste-items-warnings">
              {parsed.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
          {duplicates.length > 0 && (
            <div className="paste-cols-dup" data-testid="paste-items-dup">
              <p>既にある項目と ID が同じ行: {duplicates.map((d) => d.id).join("、")}</p>
              <label className="paste-cols-update">
                <input type="checkbox" checked={updateExisting} onChange={(e) => setUpdateExisting(e.target.checked)} data-testid="paste-items-update" />
                {" "}これらも更新する (表にある項目だけを書き換えます。空欄にした項目は空になります)
              </label>
              {updateExisting && (
                <ul data-testid="paste-items-update-list">
                  {updates.length === 0 && <li>変わる項目はありません</li>}
                  {updates.map((u) => <li key={u.id}><code>{u.id}</code>: {Object.keys(u.patch).join("、")} を更新</li>)}
                </ul>
              )}
            </div>
          )}
          {add.length > 0 && (
            <div className="paste-cols-preview" data-testid="paste-items-preview">
              <table>
                <thead><tr><th>項目 ID</th><th>ラベル</th><th>型</th><th>入出力</th><th>必須</th><th>最大長</th><th>最小長</th><th>最小値</th><th>最大値</th><th>パターン</th><th>説明</th></tr></thead>
                <tbody>
                  {add.map((c) => (
                    <tr key={c.id}>
                      <td><code>{c.id}</code></td><td>{c.label}</td><td>{typeof c.type === "string" ? c.type : ""}</td>
                      <td>{c.direction ? DIRECTION_LABEL[c.direction] : ""}</td><td>{c.required ? "○" : ""}</td>
                      <td>{c.maxLength ?? ""}</td><td>{c.minLength ?? ""}</td><td>{c.min ?? ""}</td><td>{c.max ?? ""}</td>
                      <td>{c.pattern}</td><td>{c.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="paste-cols-foot">
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>キャンセル</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={add.length === 0 && updates.length === 0}
            onClick={() => { onApply(add, updates); onClose(); }} data-testid="paste-items-add">
            {add.length === 0 && updates.length === 0 ? "追加・更新する項目がありません" : `${add.length > 0 ? `${add.length} 件を追加` : ""}${add.length > 0 && updates.length > 0 ? "、" : ""}${updates.length > 0 ? `${updates.length} 件を更新` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}
