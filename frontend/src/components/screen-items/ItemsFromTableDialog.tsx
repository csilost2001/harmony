/**
 * 「テーブルから項目を作る」ダイアログ。テーブルを選ぶと、そのカラムから画面項目の行 (型・必須・最大長・
 * カラムとの紐づけ付き) を作る。作る前に、カラムごとに取捨できる。読み取りの規則は utils/itemSuggestion.ts。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { itemsFromTable } from "../../utils/itemSuggestion";
import { isImeComposing } from "../../utils/imeKeys";
import { looseMatch } from "../../utils/textMatch";
import type { ScreenItem, Table } from "../../types/v3";
import "../../styles/pasteColumns.css";

interface Props {
  tables: readonly Table[];
  existingIds: readonly string[];
  onApply: (items: ScreenItem[], tableName: string) => void;
  onClose: () => void;
}

export function ItemsFromTableDialog({ tables, existingIds, onApply, onClose }: Props) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);
  const [query, setQuery] = useState("");
  const [tableId, setTableId] = useState<string>("");
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());

  const candidates = useMemo(
    () => tables.filter((t) => query === "" || looseMatch(t.name, query) || looseMatch(t.physicalName, query)),
    [tables, query],
  );
  const table = tables.find((t) => t.id === tableId);
  const plan = useMemo(() => (table ? itemsFromTable(table, table.columns, existingIds) : null), [table, existingIds]);
  const chosen = useMemo(
    () => (plan?.items ?? []).filter((it) => {
      const ref = it.binding?.ref;
      return !(ref && "columnId" in ref && unchecked.has(ref.columnId));
    }),
    [plan, unchecked],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !isImeComposing(e)) { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickTable = (id: string) => { setTableId(id); setUnchecked(new Set()); };

  return (
    <div className="paste-cols-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={trapRef} className="paste-cols-modal" role="dialog" aria-modal="true" aria-label="テーブルから項目を作る" data-testid="items-from-table-dialog">
        <div className="paste-cols-head">
          <h2><i className="bi bi-table" /> テーブルから画面項目を作る</h2>
          <button type="button" className="paste-cols-close" aria-label="閉じる" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="paste-cols-body">
          <p className="paste-cols-help">
            テーブルを選ぶと、カラムから画面項目の行を作ります (型・必須・最大長・テーブルのカラムとの紐づけ付き)。不要なカラムは外せます。
          </p>
          <input className="form-control form-control-sm" placeholder="テーブルを探す (名前・物理名)" value={query} onChange={(e) => setQuery(e.target.value)}
            aria-label="テーブルを探す" data-testid="items-from-table-search" autoFocus />
          <div role="listbox" aria-label="テーブル" style={{ maxHeight: "10em", overflowY: "auto", border: "1px solid var(--hm-border)", borderRadius: 6 }}>
            {candidates.length === 0 && <div style={{ padding: 8, color: "var(--hm-fg-muted)" }}>該当するテーブルがありません</div>}
            {candidates.map((t) => (
              <div key={t.id} role="option" aria-selected={t.id === tableId} tabIndex={0} data-testid={`items-from-table-pick-${t.id}`}
                onClick={() => pickTable(t.id)}
                onKeyDown={(e) => { if (e.key === "Enter" && !isImeComposing(e)) { e.preventDefault(); pickTable(t.id); } }}
                style={{ padding: "4px 10px", cursor: "pointer", background: t.id === tableId ? "var(--hm-accent-solid)" : "transparent", color: t.id === tableId ? "var(--hm-on-solid)" : "var(--hm-fg)" }}>
                {t.name} <code>{t.physicalName}</code> <small>({t.columns.length} カラム)</small>
              </div>
            ))}
          </div>

          {plan && table && (
            <div className="paste-cols-preview" data-testid="items-from-table-preview">
              <table>
                <thead><tr><th></th><th>項目 ID</th><th>ラベル</th><th>型</th><th>必須</th><th>最大長</th></tr></thead>
                <tbody>
                  {plan.items.map((it) => {
                    const ref = it.binding?.ref;
                    const colId = ref && "columnId" in ref ? ref.columnId : "";
                    return (
                      <tr key={it.id}>
                        <td><input type="checkbox" checked={!unchecked.has(colId)} aria-label={`${it.label}を作る`}
                          onChange={(e) => setUnchecked((prev) => { const n = new Set(prev); if (e.target.checked) n.delete(colId); else n.add(colId); return n; })} /></td>
                        <td><code>{it.id}</code></td><td>{it.label}</td><td>{typeof it.type === "string" ? it.type : it.type.kind}</td>
                        <td>{it.required ? "○" : ""}</td><td>{it.maxLength ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {plan.skipped.length > 0 && <p className="paste-cols-help">画面項目にできないカラム (BLOB など): {plan.skipped.join("、")}</p>}
            </div>
          )}
        </div>
        <div className="paste-cols-foot">
          <button type="button" className="tbl-btn tbl-btn-ghost" onClick={onClose}>キャンセル</button>
          <button type="button" className="tbl-btn tbl-btn-primary" disabled={chosen.length === 0}
            onClick={() => { if (table) { onApply(chosen, table.name); onClose(); } }} data-testid="items-from-table-apply">
            {chosen.length === 0 ? "テーブルを選んでください" : `${chosen.length} 項目を追加`}
          </button>
        </div>
      </div>
    </div>
  );
}
