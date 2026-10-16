/**
 * 一覧の「列の設定」(UI 改善提案 第 3 弾 #47)。列ごとの表示 / 非表示・並び・幅を、その場で変える。
 * ブラウザに覚えさせる (利用者ごと・画面ごと)。原本には書かない。
 */
import { useEffect, useRef } from "react";
import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, isDefaultPrefs, moveColumn, setWidth, toggleHidden, type ColumnPrefs } from "../../utils/columnPrefs";

export interface ColumnPrefsMenuProps {
  /** いまの並びの、全部の列 (隠した列も含む) */
  columns: Array<{ key: string; label: string }>;
  prefs: ColumnPrefs;
  /** 画面に出ている列の、いまの幅 (px)。幅の欄の初期値 */
  measured: Record<string, number>;
  onChange: (next: ColumnPrefs) => void;
  onClose: () => void;
  /** 開く位置 (画面の座標)。省略すると、ボタンの下 */
  at?: { x: number; y: number };
}

export function ColumnPrefsMenu({ columns, prefs, measured, onChange, onClose, at }: ColumnPrefsMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const keys = columns.map((c) => c.key);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("input,button")?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); } };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("mousedown", onDown, { capture: true });
    return () => { window.removeEventListener("keydown", onKey, { capture: true }); window.removeEventListener("mousedown", onDown, { capture: true }); };
  }, [onClose]);
  const setOrder = (order: string[]) => onChange({ ...prefs, order });
  const style = at ? { position: "fixed" as const, left: Math.min(at.x, window.innerWidth - 320), top: Math.min(at.y, window.innerHeight - 360) } : undefined;
  return (
    <div ref={ref} className={`column-prefs-menu${at ? "" : " is-anchored"}`} style={style} role="group" aria-label="列の設定" data-testid="column-prefs-menu">
      <div className="column-prefs-title">列の設定 <small>(このブラウザに覚えます)</small></div>
      <ul className="column-prefs-list">
        {columns.map((c, i) => {
          const hidden = prefs.hidden.includes(c.key);
          return (
            <li key={c.key} className={hidden ? "is-hidden" : ""}>
              <label className="column-prefs-show">
                <input type="checkbox" checked={!hidden} onChange={() => onChange(toggleHidden({ ...prefs, order: keys }, c.key, keys))} data-testid={`column-prefs-show-${c.key}`} />
                {c.label}
              </label>
              <input
                type="number" className="column-prefs-width" min={MIN_COLUMN_WIDTH} max={MAX_COLUMN_WIDTH} placeholder={"既定: 自動"}
                aria-label={`${c.label}の幅 (px)`} disabled={hidden}
                value={prefs.widths[c.key] ?? ""}
                onChange={(e) => onChange(setWidth(prefs, c.key, e.target.value === "" ? null : Number(e.target.value)))}
                title={measured[c.key] ? `いまの幅: ${Math.round(measured[c.key])}px` : undefined}
                data-testid={`column-prefs-width-${c.key}`}
              />
              <button type="button" className="column-prefs-move" aria-label={`${c.label}を前へ`} disabled={i === 0} onClick={() => setOrder(moveColumn(keys, c.key, -1))} data-testid={`column-prefs-up-${c.key}`}><i className="bi bi-arrow-up" /></button>
              <button type="button" className="column-prefs-move" aria-label={`${c.label}を後ろへ`} disabled={i === columns.length - 1} onClick={() => setOrder(moveColumn(keys, c.key, 1))} data-testid={`column-prefs-down-${c.key}`}><i className="bi bi-arrow-down" /></button>
            </li>
          );
        })}
      </ul>
      <div className="column-prefs-foot">
        <button type="button" className="btn btn-sm btn-outline-secondary" disabled={isDefaultPrefs(prefs)} onClick={() => onChange({ widths: {}, hidden: [], order: [] })} data-testid="column-prefs-reset">既定に戻す</button>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}
