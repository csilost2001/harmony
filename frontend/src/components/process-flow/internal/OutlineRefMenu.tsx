/**
 * アウトラインの行で、`[DBアクセス:` のあとに出す、参照先 (テーブル・処理フロー・画面・外部システム) の選択メニュー。
 * 入力で絞り込み (ID・名前)、↑↓ Enter で選ぶ。見た目は工程の挿入メニューと同じ。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeQuery } from "../../../utils/quickOpen";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import "../../../styles/stepInsertMenu.css";
import { isImeComposing } from "../../../utils/imeKeys";

export interface RefCandidate { id: string; label: string }

export function filterRefCandidates(list: readonly RefCandidate[], query: string): RefCandidate[] {
  const tokens = normalizeQuery(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...list];
  return list.filter((c) => {
    const hay = normalizeQuery(`${c.id} ${c.label}`);
    return tokens.every((t) => hay.includes(t));
  });
}

interface Props {
  title: string;
  candidates: readonly RefCandidate[];
  onPick: (id: string) => void;
  onClose: () => void;
}

export function OutlineRefMenu({ title, candidates, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useFocusTrap(rootRef, true);
  const hits = useMemo(() => filterRefCandidates(candidates, query), [candidates, query]);
  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView?.({ block: "nearest" }); }, [cursor]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, Math.max(hits.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && !isImeComposing(e)) { e.preventDefault(); if (hits[cursor]) onPick(hits[cursor].id); }
  };

  return (
    <div className="step-insert-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={rootRef} className="step-insert-modal" role="dialog" aria-modal="true" aria-label={`${title}を選ぶ`} data-testid="outline-ref-menu">
        <div className="step-insert-head"><i className="bi bi-link-45deg" /> {title}を選ぶ</div>
        <input
          autoFocus
          className="step-insert-input"
          placeholder={`${title}の ID や名前を入力`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded="true"
          aria-controls="outline-ref-list"
          aria-activedescendant={hits[cursor] ? `outline-ref-opt-${cursor}` : undefined}
          data-testid="outline-ref-input"
        />
        <ul className="step-insert-list" id="outline-ref-list" role="listbox" ref={listRef}>
          {hits.length === 0 && <li className="step-insert-empty">該当するものがありません</li>}
          {hits.map((c, i) => (
            <li
              key={c.id}
              id={`outline-ref-opt-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === cursor}
              className={`step-insert-item${i === cursor ? " active" : ""}`}
              onMouseMove={() => setCursor(i)}
              onClick={() => onPick(c.id)}
              data-testid="outline-ref-item"
            >
              <span className="step-insert-label">{c.label}</span>
              <span className="step-insert-kind">{c.id}</span>
            </li>
          ))}
        </ul>
        <div className="step-insert-foot"><kbd>↑</kbd><kbd>↓</kbd> 選ぶ <kbd>Enter</kbd> 入れる <kbd>Esc</kbd> やめる</div>
      </div>
    </div>
  );
}
