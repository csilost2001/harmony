/** その場で書き換えられる文字 (編集中だけ)。クリックで入力欄になり、Enter か外へ出ると確定、Esc でやめる */
import { isPlainEnter } from "../../../utils/imeKeys";
import { useEffect, useRef, useState } from "react";

export interface InlineTextProps {
  value: string;
  editable: boolean;
  placeholder: string;
  onCommit: (next: string) => void;
  className?: string;
  maxLength?: number;
  /** 外から、入力欄にしたいとき (挿入した直後など) */
  autoEdit?: boolean;
  ariaLabel?: string;
}

export function InlineText({ value, editable, placeholder, onCommit, className, maxLength, autoEdit, ariaLabel }: InlineTextProps) {
  const [editing, setEditing] = useState(Boolean(autoEdit && editable));
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);

  if (!editable) return <span className={className}>{value || ""}</span>;
  if (!editing) {
    return (
      <span
        className={`${className ?? ""} pfs-inline${value ? "" : " is-empty"}`}
        role="button"
        tabIndex={0}
        title="クリックで書き換える"
        aria-label={ariaLabel ?? placeholder}
        onClick={(e) => { e.stopPropagation(); setDraft(value); cancelled.current = false; setEditing(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setDraft(value); cancelled.current = false; setEditing(true); } }}
      >
        {value || placeholder}
      </span>
    );
  }
  const finish = () => {
    setEditing(false);
    if (cancelled.current) return;
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      ref={input}
      className="pfs-inline-input"
      value={draft}
      maxLength={maxLength}
      aria-label={ariaLabel ?? placeholder}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (isPlainEnter(e)) { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
        if (e.key === "Escape") { cancelled.current = true; (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}
