/**
 * 入力欄の「?」。押すと、その項目の短い説明と、くわしい仕様書の場所が出る (話題は utils/helpTopics.ts)。
 */
import { useEffect, useId, useRef, useState } from "react";
import { helpTopic } from "../../utils/helpTopics";
import "../../styles/helpHint.css";

export function HelpHint({ topic, className }: { topic: string; className?: string }) {
  const t = helpTopic(topic);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  if (!t) return null;
  return (
    <span className={`help-hint${className ? ` ${className}` : ""}`} ref={rootRef}>
      <button type="button" className="help-hint-btn" aria-label={`${t.title}の説明`} aria-expanded={open} aria-controls={open ? popId : undefined}
        data-testid={`help-${topic}`} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}>
        <i className="bi bi-question-circle" aria-hidden="true" />
      </button>
      {open && (
        <span id={popId} role="dialog" aria-label={`${t.title}の説明`} className="help-hint-pop" data-testid="help-hint-pop"
          onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
          <strong>{t.title}</strong>
          {t.body.map((p, i) => <span key={i} className="help-hint-p">{p}</span>)}
          {t.doc && <span className="help-hint-doc">くわしくは: <code>{t.doc}</code></span>}
        </span>
      )}
    </span>
  );
}
