import { useState, useRef, useCallback } from "react";
import { computeReferenceCompletion, insertReferenceCandidate } from "../../utils/reference-completer/completer";
import type { Candidate, CompletionContext, Resolver } from "../../utils/reference-completer/types";

interface ReferenceCompletionTextareaProps {
  value: string;
  onValueChange: (v: string) => void;
  onCommit?: () => void;
  /** 有効化する Resolver 一覧。 */
  resolvers: Resolver[];
  /** CompletionContext。conventions / workspace / flow / extensions 等を渡す。 */
  ctx: CompletionContext;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
}

/**
 * 統合 reference 補完ポップアップ付き textarea。
 * ReferenceCompletionInput の textarea 版 (Phase 3 / #1255)。
 */
export function ReferenceCompletionTextarea({
  value,
  onValueChange,
  onCommit,
  resolvers,
  ctx,
  className,
  style,
  placeholder,
  disabled,
  rows = 2,
}: ReferenceCompletionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [suppressed, setSuppressed] = useState(false);

  const state = suppressed
    ? ({ phase: "idle" } as const)
    : computeReferenceCompletion(value, cursorPos, resolvers, ctx);

  const candidates: Candidate[] = state.phase === "active" ? state.candidates : [];
  const isOpen = candidates.length > 0;
  const safeIndex = candidates.length > 0 ? Math.min(activeIndex, candidates.length - 1) : 0;

  const pick = useCallback(
    (candidate: Candidate) => {
      const pos = textareaRef.current?.selectionStart ?? value.length;
      const st = computeReferenceCompletion(value, pos, resolvers, ctx);
      if (st.phase === "idle") return;
      const { newValue, newCursor } = insertReferenceCandidate(value, pos, st, candidate);
      onValueChange(newValue);
      setSuppressed(false);
      setActiveIndex(0);
      setCursorPos(newCursor);
      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(newCursor, newCursor);
        textareaRef.current?.focus();
      });
    },
    [value, resolvers, ctx, onValueChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % candidates.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length);
    } else if (e.key === "Tab") {
      if (candidates[safeIndex]) {
        e.preventDefault();
        pick(candidates[safeIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSuppressed(true);
    }
    // Enter: textarea ではデフォルト改行のため Tab のみ補完確定
  };

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={textareaRef}
        className={className}
        style={style}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        rows={rows}
        onChange={(e) => {
          const pos = e.target.selectionStart ?? e.target.value.length;
          setCursorPos(pos);
          setActiveIndex(0);
          setSuppressed(false);
          onValueChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onSelect={(e) => {
          setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0);
        }}
        onBlur={() => {
          setTimeout(() => setSuppressed(true), 150);
          onCommit?.();
        }}
        onFocus={() => setSuppressed(false)}
      />
      {isOpen && (
        <ul
          role="listbox"
          aria-label="補完候補"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 9999,
            background: "#fff",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
            margin: "2px 0 0",
            padding: "4px 0",
            minWidth: "16em",
            maxHeight: "14em",
            overflowY: "auto",
            listStyle: "none",
          }}
        >
          {candidates.map((c, i) => (
            <li
              key={`${c.value}-${i}`}
              role="option"
              aria-selected={i === safeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              style={{
                padding: "4px 12px",
                cursor: "pointer",
                background: i === safeIndex ? "#6366f1" : "transparent",
                color: i === safeIndex ? "#fff" : "#1e293b",
                borderRadius: i === safeIndex ? 3 : 0,
                margin: "0 4px",
              }}
            >
              <span
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  fontSize: "0.82rem",
                }}
              >
                {c.label ?? c.value}
              </span>
              {c.hint && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: "0.75rem",
                    opacity: 0.65,
                  }}
                >
                  {c.hint}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
