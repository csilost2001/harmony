/**
 * 工程 (ステップ) の挿入メニュー。キーボードで、種類を打ち込んで選び、Enter で挿入する。
 * 処理フローの工程にフォーカスがあるときの `Insert` / `/`、入力欄の中の `Ctrl+Enter` で開く。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { StepKind } from "../../../types/v3";
import { STEP_TYPE_ICONS, STEP_TYPE_LABELS } from "../../../utils/processFlowMetadata";
import { normalizeQuery } from "../../../utils/quickOpen";
import { useFocusTrap } from "../../../hooks/useFocusTrap";
import "../../../styles/stepInsertMenu.css";

interface Props {
  kinds: readonly StepKind[];
  /** どこへ挿入するかの説明 (例: 「3 の後ろに」) */
  where?: string;
  onPick: (kind: StepKind) => void;
  onClose: () => void;
}

/** 種類を絞り込む (日本語名・種類名・説明に、空白区切りの語がすべて含まれる)。空なら全部 */
export function filterStepKinds(kinds: readonly StepKind[], query: string): StepKind[] {
  const tokens = normalizeQuery(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...kinds];
  return kinds.filter((k) => {
    const hay = normalizeQuery(`${STEP_TYPE_LABELS[k] ?? ""} ${k}`);
    return tokens.every((t) => hay.includes(t));
  });
}

export function StepInsertMenu({ kinds, where, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useFocusTrap(rootRef);
  const hits = useMemo(() => filterStepKinds(kinds, query), [kinds, query]);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView?.({ block: "nearest" }); }, [cursor]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, Math.max(hits.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (hits[cursor]) onPick(hits[cursor]); }
  };

  return (
    <div className="step-insert-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={rootRef} className="step-insert-modal" role="dialog" aria-modal="true" aria-label="工程を挿入" data-testid="step-insert-menu">
        <div className="step-insert-head">
          <i className="bi bi-plus-circle" /> 工程を挿入{where ? <small>{where}</small> : null}
        </div>
        <input
          autoFocus
          className="step-insert-input"
          placeholder="工程の種類を入力 (例: DB、分岐、画面遷移)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKey}
          role="combobox"
          aria-expanded="true"
          aria-controls="step-insert-list"
          aria-activedescendant={hits[cursor] ? `step-insert-opt-${hits[cursor]}` : undefined}
          data-testid="step-insert-input"
        />
        <ul className="step-insert-list" id="step-insert-list" role="listbox" ref={listRef}>
          {hits.length === 0 && <li className="step-insert-empty">該当する種類がありません</li>}
          {hits.map((k, i) => (
            <li
              key={k}
              id={`step-insert-opt-${k}`}
              data-index={i}
              data-kind={k}
              role="option"
              aria-selected={i === cursor}
              className={`step-insert-item${i === cursor ? " active" : ""}`}
              onMouseMove={() => setCursor(i)}
              onClick={() => onPick(k)}
              data-testid="step-insert-item"
            >
              <i className={STEP_TYPE_ICONS[k] ?? "bi bi-circle"} />
              <span className="step-insert-label">{STEP_TYPE_LABELS[k] ?? k}</span>
              <span className="step-insert-kind">{k}</span>
            </li>
          ))}
        </ul>
        <div className="step-insert-foot"><kbd>↑</kbd><kbd>↓</kbd> 選ぶ <kbd>Enter</kbd> 挿入 <kbd>Esc</kbd> やめる</div>
      </div>
    </div>
  );
}
