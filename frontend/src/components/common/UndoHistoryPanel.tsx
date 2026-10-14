/**
 * 変更履歴パネル。「元に戻す」で戻れる操作を、時間順に一覧する (どの操作かは、前後の差から自動で付けた呼び名)。
 * 行を選ぶと、その操作の後の状態へ一度に移る (戻りすぎたら、同じ一覧でやり直せる)。保存済みの内容は変わらない。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { UndoHistoryView } from "../../hooks/useUndoableState";
import { buildHistoryRows, visibleHistoryRows } from "../../utils/undoHistory";
import "../../styles/undoHistory.css";

interface Props {
  history: UndoHistoryView<unknown>;
  present: unknown;
  onJump: (delta: number) => void;
  /** 開くボタンの class (置く場所のほかのボタンに合わせる) */
  buttonClassName?: string;
}

export function UndoHistoryPanel({ history, present, onJump, buttonClassName = "editor-header-undo-btn" }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const count = history.past.length + history.future.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // 開いている間だけ、差を計算する (閉じているときの編集で、重い比較をしない)
  const rows = useMemo(() => (open ? visibleHistoryRows(buildHistoryRows(history.past, present, history.future)) : []), [open, history, present]);
  const first = history.past.length === 0 && history.future.length > 0;

  return (
    <span className="uh-wrap" ref={rootRef} onKeyDown={(e) => { if (open && e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" className={buttonClassName} data-testid="undo-history-open" disabled={count === 0 && !open}
        title={count === 0 ? "変更履歴 (まだ操作がありません)" : `変更履歴 (戻れる操作 ${history.past.length} 件)`} aria-label="変更履歴" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        <i className="bi bi-clock-history" />
      </button>
      {open && (
        <div className="uh-pop" role="dialog" aria-label="変更履歴" data-testid="undo-history">
          <div className="uh-head"><strong>変更履歴</strong><small>行を選ぶと、その操作の後の状態へ移ります (Ctrl+Z / Ctrl+Y と同じ履歴)</small></div>
          {rows.length === 0 ? (
            <p className="uh-empty">まだ操作がありません。編集すると、ここに並びます。</p>
          ) : (
            <ol className="uh-list">
              {first && <li className="uh-now-note">いまは、いちばん古い状態です</li>}
              {rows.map((r) => (
                <li key={r.index} className={`uh-row${r.current ? " is-current" : ""}${r.future ? " is-future" : ""}`} data-testid="undo-history-row" data-delta={r.delta}>
                  <button type="button" onClick={() => { onJump(r.delta); setOpen(false); }} disabled={r.current}
                    title={r.current ? "いまの状態" : r.future ? "この操作をやり直す" : "ここまで戻す"}>
                    <span className="uh-no">{r.index + 1}</span>
                    <span className="uh-label">{r.label}</span>
                    <span className="uh-tag">{r.current ? "いま" : r.future ? "やり直せる" : ""}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </span>
  );
}
