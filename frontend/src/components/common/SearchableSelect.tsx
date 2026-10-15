import { useEffect, useId, useMemo, useRef, useState } from "react";
import { recordCompletionPick } from "../../utils/completionHistory";
import { filterOptions, type SelectOption } from "../../utils/selectOptions";
import { isImeComposing } from "../../utils/imeKeys";


interface Props {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /** 未選択を表す先頭の項目の名前 (例: 「（選択）」)。無ければ未選択の項目を出さない */
  emptyLabel?: string;
  /** 候補がこの件数以下なら、ふつうの `<select>` にする (小さな一覧は、探すより見るほうが速い) */
  threshold?: number;
  className?: string;
  disabled?: boolean;
  ariaLabel?: string;
  id?: string;
  /** よく使う候補の履歴を分ける名前 (同じ種類の選択で同じ名前を使う)。省略時は履歴を使わない */
  historyKey?: string;
  onBlur?: () => void;
  placeholder?: string;
  "data-testid"?: string;
}

/**
 * 候補が多い選択欄。文字を打つと絞り込み (名前・補足・かなや全角半角の違いを無視)、↑↓ で選び、Enter で決める。
 * 候補が少ないとき (threshold 以下) は、ふつうの `<select>` のまま。
 */
export function SearchableSelect({
  value, onChange, options, emptyLabel, threshold = 20, className, disabled, ariaLabel, id, historyKey, onBlur, placeholder, "data-testid": testId,
}: Props) {
  if (options.length <= threshold) {
    return (
      <select id={id} className={className} value={value} disabled={disabled} aria-label={ariaLabel} data-testid={testId}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur}>
        {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
        {options.map((o) => <option key={o.value} value={o.value}>{o.hint ? `${o.label}（${o.hint}）` : o.label}</option>)}
        {value && !options.some((o) => o.value === value) && <option value={value}>{value}</option>}
      </select>
    );
  }
  return (
    <Combo value={value} onChange={onChange} options={options} emptyLabel={emptyLabel} className={className} disabled={disabled}
      ariaLabel={ariaLabel} id={id} historyKey={historyKey} onBlur={onBlur} placeholder={placeholder} testId={testId} />
  );
}

function Combo({ value, onChange, options, emptyLabel, className, disabled, ariaLabel, id, historyKey, onBlur, placeholder, testId }: Omit<Props, "threshold" | "data-testid"> & { testId?: string }) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const selected = options.find((o) => o.value === value);
  const shown = selected ? (selected.hint ? `${selected.label}（${selected.hint}）` : selected.label) : value;
  const hits = useMemo(() => filterOptions(options, query, historyKey), [options, query, historyKey]);
  // 未選択の項目は、入力が空のときだけ先頭に出す
  const rows: SelectOption[] = useMemo(() => (emptyLabel !== undefined && query.trim() === "" ? [{ value: "", label: emptyLabel }, ...hits] : hits), [emptyLabel, query, hits]);

  useEffect(() => {
    if (open) rootRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [cursor, open]);

  const pick = (o: SelectOption) => {
    if (historyKey && o.value) recordCompletionPick(`select:${historyKey}`, o.value);
    onChange(o.value);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeComposing(e)) return;
    if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else setCursor((c) => Math.min(c + 1, Math.max(rows.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && open) { e.preventDefault(); if (rows[cursor]) pick(rows[cursor]); }
    else if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); setQuery(""); }
  };

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={ariaLabel}
        aria-activedescendant={open && rows[cursor] ? `${listId}-${cursor}` : undefined}
        className={className}
        disabled={disabled}
        autoComplete="off"
        data-testid={testId}
        placeholder={open ? "探す (名前・ID)" : (placeholder ?? (emptyLabel ?? ""))}
        value={open ? query : shown}
        title="文字を打つと絞り込めます。↑↓ で選び、Enter で決めます"
        onFocus={() => { setOpen(true); setQuery(""); setCursor(0); requestAnimationFrame(() => inputRef.current?.select()); }}
        onChange={(e) => { setOpen(true); setQuery(e.target.value); setCursor(0); }}
        onKeyDown={onKeyDown}
        onBlur={() => { setTimeout(() => { setOpen(false); setQuery(""); }, 120); onBlur?.(); }}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label={ariaLabel ? `${ariaLabel}の候補` : "候補"}
          style={{ position: "absolute", top: "100%", left: 0, minWidth: "100%", zIndex: 9999, background: "var(--hm-surface)", border: "1px solid var(--hm-border-strong)", borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.12)", margin: "2px 0 0", padding: "4px 0", maxHeight: "16em", overflowY: "auto", listStyle: "none" }}>
          {rows.length === 0 && <li style={{ padding: "4px 12px", color: "var(--hm-fg-muted)" }}>該当する候補がありません</li>}
          {rows.map((o, i) => (
            <li key={o.value || "__empty"} id={`${listId}-${i}`} data-index={i} role="option" aria-selected={o.value === value}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
              onMouseMove={() => setCursor(i)}
              style={{ padding: "4px 12px", cursor: "pointer", margin: "0 4px", borderRadius: 3,
                background: i === cursor ? "var(--hm-accent-solid)" : "transparent", color: i === cursor ? "var(--hm-on-solid)" : "var(--hm-fg)",
                fontWeight: o.value === value ? 600 : undefined }}>
              {o.label}
              {o.hint && <span style={{ marginLeft: 8, fontSize: "0.75rem", opacity: 0.7 }}>{o.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
