import { useEffect, useRef, useState } from "react";
import type { ListClipboard } from "../../hooks/useListClipboard";
import { showToast } from "../../utils/toast";
import "../../styles/columnImpact.css";

interface Props<T> {
  clipboard: ListClipboard<T>;
  /** 中身を 1 行で表す (例: カラム名・項目名・工程の説明) */
  describe: (item: T) => string;
  /** 「工程」「カラム」など、貼り付けるものの呼び名 */
  noun: string;
  disabled?: boolean;
}

/** 直近のコピー / 切り取りの履歴から選び直す (ブラウザ内・メモリのみ。続編 第 8 弾 #159)。Ctrl+Shift+V でも開く */
export function ClipboardHistoryMenu<T>({ clipboard, describe, noun, disabled }: Props<T>) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const { history, restoreFromHistory } = clipboard;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
      if (!(e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "v")) return;
      // 表示されていない編集画面 (裏のタブ) では反応しない
      if (!root.current || root.current.offsetParent === null || disabled) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled]);

  if (history.length === 0) return <span ref={root} />;

  return (
    <span ref={root} className="clip-history">
      <button type="button" className="btn btn-sm btn-outline-secondary" disabled={disabled}
        onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="clip-history-toggle"
        title={`直近にコピーした ${noun} から選び直す (Ctrl+Shift+V)`}>
        <i className="bi bi-clock-history me-1" /> 履歴 ({history.length})
      </button>
      {open && (
        <ul className="clip-history-list" data-testid="clip-history-list" role="menu">
          {history.map((e, i) => (
            <li key={e.at + ":" + i}>
              <button type="button" role="menuitem" className="clip-history-item" data-testid="clip-history-item"
                onClick={() => {
                  restoreFromHistory(i);
                  setOpen(false);
                  showToast(`${e.items.length} 件の${noun}を、クリップボードに戻しました (Ctrl+V で貼り付け)`, "info");
                }}>
                <strong>{e.items.length} 件</strong>
                <span className="clip-history-text">{e.items.slice(0, 3).map(describe).join("、")}{e.items.length > 3 ? " ほか" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
