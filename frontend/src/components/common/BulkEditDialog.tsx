/**
 * 一括変更ダイアログ。選んだ行 (カラム・画面項目) の、型・必須・長さなどをまとめて変える。
 * 変える項目を選んで値を入れると、「どの行の何が、どう変わるか」が予行で見える。確定すると編集中の内容に反映する
 * (保存はしない。Ctrl+Z で元に戻せる)。計算は utils/bulkEdit.ts。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { planBulkEdit, type BulkChange, type BulkField } from "../../utils/bulkEdit";
import "../../styles/pasteColumns.css";
import "../../styles/bulkEdit.css";

interface Props<T extends object> {
  title: string;
  fields: ReadonlyArray<BulkField<T>>;
  items: readonly T[];
  /** 行の呼び名 (予行の表に出す) */
  itemLabel: (item: T) => string;
  /** 確定。index は items の位置、patch は反映する値 (undefined = 消す) */
  onApply: (patches: Array<{ index: number; patch: Record<string, unknown> }>) => void;
  onClose: () => void;
}

interface FieldState { on: boolean; raw: string }

const show = (v: unknown): string => (v === undefined || v === null || v === "" ? "(なし)" : typeof v === "boolean" ? (v ? "はい" : "いいえ") : String(v));

/** 入力欄の文字を、反映する値にする。空欄 = 値を消す (undefined)。数値でないときは NaN */
function toValue(field: BulkField<never>, raw: string): unknown {
  if (field.kind === "tri") return raw === "true" ? true : raw === "false" ? false : undefined;
  if (raw.trim() === "") return undefined;
  if (field.kind === "number") return Number(raw);
  return raw;
}

export function BulkEditDialog<T extends object>({ title, fields, items, itemLabel, onApply, onClose }: Props<T>) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef);
  const [state, setState] = useState<Record<string, FieldState>>(() => Object.fromEntries(fields.map((f) => [f.key, { on: false, raw: f.kind === "tri" ? "true" : "" }])));
  const set = (key: string, patch: Partial<FieldState>) => setState((s) => ({ ...s, [key]: { ...s[key], ...patch } }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const changes = useMemo<BulkChange[]>(
    () => fields.filter((f) => state[f.key]?.on).map((f) => ({ key: f.key, value: toValue(f as BulkField<never>, state[f.key].raw) })),
    [fields, state],
  );
  const plan = useMemo(() => planBulkEdit(items, fields, changes), [items, fields, changes]);
  const label = (key: string) => fields.find((f) => f.key === key)?.label ?? key;
  const rowsWithChange = plan.rows.filter((r) => Object.keys(r.patch).length > 0 || r.skipped.length > 0);
  const canApply = changes.length > 0 && plan.invalid.length === 0 && plan.changedRows > 0;

  return (
    <div className="paste-cols-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={trapRef} className="paste-cols-modal" role="dialog" aria-modal="true" aria-label={title} data-testid="bulk-edit-dialog">
        <div className="paste-cols-head">
          <h2><i className="bi bi-sliders" /> {title} ({items.length} 件)</h2>
          <button type="button" className="paste-cols-close" aria-label="閉じる" onClick={onClose}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="paste-cols-body">
          <p className="paste-cols-help">変える項目にチェックを入れて、値を決めます。下の予行で、どの行がどう変わるかを確かめてから反映します (保存はされません。Ctrl+Z で元に戻せます)。</p>
          <div className="bulk-fields">
            {fields.map((f) => {
              const st = state[f.key];
              const bad = plan.invalid.find((i) => i.key === f.key);
              return (
                <div key={f.key} className={`bulk-field${st.on ? " is-on" : ""}`}>
                  <label className="bulk-field-check">
                    <input type="checkbox" checked={st.on} onChange={(e) => set(f.key, { on: e.target.checked })} data-testid={`bulk-on-${f.key}`} />
                    {f.label}
                  </label>
                  {f.kind === "select" && (
                    <select value={st.raw} disabled={!st.on} onChange={(e) => set(f.key, { raw: e.target.value })} aria-label={`${f.label}の値`} data-testid={`bulk-value-${f.key}`}>
                      <option value="">(選ぶ)</option>
                      {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  )}
                  {f.kind === "tri" && (
                    <select value={st.raw} disabled={!st.on} onChange={(e) => set(f.key, { raw: e.target.value })} aria-label={`${f.label}の値`} data-testid={`bulk-value-${f.key}`}>
                      <option value="true">はい</option>
                      <option value="false">いいえ</option>
                      <option value="clear">指定なしにする</option>
                    </select>
                  )}
                  {(f.kind === "number" || f.kind === "text") && (
                    <input type={f.kind === "number" ? "number" : "text"} value={st.raw} disabled={!st.on} onChange={(e) => set(f.key, { raw: e.target.value })}
                      placeholder="例: 空欄 = 値を消す" aria-label={`${f.label}の値`} data-testid={`bulk-value-${f.key}`} />
                  )}
                  {bad && st.on && <span className="bulk-bad" role="alert">{bad.reason}</span>}
                </div>
              );
            })}
          </div>

          <div className="paste-cols-preview" data-testid="bulk-preview">
            {changes.length === 0 ? (
              <p className="bulk-note">変える項目を選ぶと、ここに予行が出ます。</p>
            ) : rowsWithChange.length === 0 ? (
              <p className="bulk-note" data-testid="bulk-nochange">選んだ行は、すでにその値です (変わる行はありません)。</p>
            ) : (
              <table>
                <thead><tr><th>行</th><th>変更の内容</th></tr></thead>
                <tbody>
                  {rowsWithChange.map((r) => (
                    <tr key={r.index} data-testid="bulk-preview-row">
                      <td><code>{itemLabel(items[r.index])}</code></td>
                      <td className="bulk-changes">
                        {Object.keys(r.patch).map((k) => <span key={k} className="bulk-chg">{label(k)}: {show(r.before[k])} → <strong>{show(r.patch[k])}</strong></span>)}
                        {r.skipped.map((s) => <span key={s.key} className="bulk-skip">{label(s.key)}: 飛ばします ({s.reason})</span>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <div className="paste-cols-foot">
          <span className="bulk-count">{canApply ? `${plan.changedRows} 行が変わります` : ""}</span>
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>キャンセル</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={!canApply} data-testid="bulk-apply"
            onClick={() => { onApply(plan.rows.filter((r) => Object.keys(r.patch).length > 0).map((r) => ({ index: r.index, patch: r.patch }))); onClose(); }}>
            {plan.changedRows} 行に反映
          </button>
        </div>
      </div>
    </div>
  );
}
