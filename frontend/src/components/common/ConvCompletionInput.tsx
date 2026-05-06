import { useState, useRef, useCallback } from "react";
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";
import { computeCompletion, insertCandidate } from "../../hooks/useConvCompletion";

interface ConvCompletionInputProps {
  value: string;
  onValueChange: (v: string) => void;
  onCommit?: () => void;
  conventions: ConventionsCatalog | null;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * @conv.* 補完ポップアップ付き input。
 * `@conv.` 入力でカテゴリ一覧、`@conv.currency.` で key 一覧を表示する。
 * ↑↓ で選択、Enter/Tab で確定、Esc で閉じる。
 */
export function ConvCompletionInput({
  value,
  onValueChange,
  onCommit,
  conventions,
  className,
  style,
  placeholder,
  disabled,
}: ConvCompletionInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [cursorPos, setCursorPos] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [suppressed, setSuppressed] = useState(false);

  const state = suppressed
    ? ({ phase: "idle" } as const)
    : computeCompletion(value, cursorPos, conventions);

  const candidates = state.phase !== "idle" ? state.candidates : [];
  const isOpen = candidates.length > 0;
  const safeIndex = candidates.length > 0 ? Math.min(activeIndex, candidates.length - 1) : 0;

  const pick = useCallback((candidate: string) => {
    const pos = inputRef.current?.selectionStart ?? value.length;
    const st = computeCompletion(value, pos, conventions);
    if (st.phase === "idle") return;
    const { newValue, newCursor } = insertCandidate(value, pos, st, candidate);
    onValueChange(newValue);
    setSuppressed(false);
    setActiveIndex(0);
    setCursorPos(newCursor);
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(newCursor, newCursor);
      inputRef.current?.focus();
    });
  }, [value, conventions, onValueChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % candidates.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + candidates.length) % candidates.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (candidates[safeIndex]) {
        e.preventDefault();
        pick(candidates[safeIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setSuppressed(true);
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        className={className}
        style={style}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        onChange={(e) => {
          const pos = e.target.selectionStart ?? e.target.value.length;
          setCursorPos(pos);
          setActiveIndex(0);
          setSuppressed(false);
          onValueChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        onSelect={(e) => {
          setCursorPos((e.target as HTMLInputElement).selectionStart ?? 0);
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
          aria-label="@conv 補完候補"
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
              key={c}
              role="option"
              aria-selected={i === safeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(c);
              }}
              style={{
                padding: "4px 12px",
                cursor: "pointer",
                fontSize: "0.82rem",
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                background: i === safeIndex ? "#6366f1" : "transparent",
                color: i === safeIndex ? "#fff" : "#1e293b",
                borderRadius: i === safeIndex ? 3 : 0,
                margin: "0 4px",
              }}
            >
              {state.phase === "category"
                ? <><span style={{ opacity: 0.6 }}>@conv.</span><strong>{c}</strong></>
                : c
              }
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
