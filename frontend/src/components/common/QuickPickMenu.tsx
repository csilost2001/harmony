/**
 * 一覧から、種類を打ち込んで絞り込み、↑↓ Enter で選ぶ小さなメニュー (部品・工程などの「追加」のキー操作用)。
 * 絞り込みは、名前・補足・かなや全角半角の違いを無視する (utils/textMatch)。
 */
import { useId, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { isImeComposing } from "../../utils/imeKeys";
import { rankByMatch } from "../../utils/textMatch";
import "../../styles/stepInsertMenu.css";

export interface QuickPickItem {
  value: string;
  label: string;
  /** 検索にも使う補足 (種類名など) */
  hint?: string;
  /** Bootstrap Icons のクラス */
  icon?: string;
}

interface Props {
  title: string;
  /** どこへ追加するかの説明 (例: 「選んだ部品の後ろに」) */
  where?: string;
  placeholder?: string;
  items: readonly QuickPickItem[];
  onPick: (value: string) => void;
  onClose: () => void;
}

export function QuickPickMenu({ title, where, placeholder, items, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  useFocusTrap(rootRef, true, onClose);
  const hits = useMemo(
    () => (query.trim() === "" ? [...items] : rankByMatch([...items], query, (it) => [it.label, it.hint, it.value])),
    [items, query],
  );

  const onKey = (e: React.KeyboardEvent) => {
    if (isImeComposing(e)) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, Math.max(hits.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && !isImeComposing(e)) { e.preventDefault(); if (hits[cursor]) onPick(hits[cursor].value); }
  };

  return (
    <div className="step-insert-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={rootRef} className="step-insert-modal" role="dialog" aria-modal="true" aria-label={title} data-testid="quick-pick-menu">
        <div className="step-insert-head">
          <i className="bi bi-plus-circle" /> {title}{where ? <small>{where}</small> : null}
        </div>
        <input
          autoFocus
          className="step-insert-input"
          placeholder={placeholder ?? "種類を入力して絞り込み"}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCursor(0); }}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={hits[cursor] ? `${listId}-${cursor}` : undefined}
          data-testid="quick-pick-input"
        />
        <ul className="step-insert-list" id={listId} role="listbox">
          {hits.length === 0 && <li className="step-insert-empty">該当するものがありません</li>}
          {hits.map((it, i) => (
            <li key={it.value} id={`${listId}-${i}`} role="option" aria-selected={i === cursor} data-value={it.value}
              className={`step-insert-item${i === cursor ? " active" : ""}`} data-testid="quick-pick-item"
              onMouseMove={() => setCursor(i)} onClick={() => onPick(it.value)}>
              <i className={it.icon ?? "bi bi-circle"} />
              <span className="step-insert-label">{it.label}</span>
              {it.hint && <span className="step-insert-kind">{it.hint}</span>}
            </li>
          ))}
        </ul>
        <div className="step-insert-foot"><kbd>↑</kbd><kbd>↓</kbd> 選ぶ <kbd>Enter</kbd> 追加 <kbd>Esc</kbd> やめる</div>
      </div>
    </div>
  );
}
