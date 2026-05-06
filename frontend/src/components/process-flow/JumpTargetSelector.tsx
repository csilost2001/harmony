import { useState, useRef, useEffect, useCallback } from "react";
import type { Step } from "../../types/action";
import { getJumpTargetOptions } from "../../utils/actionUtils";

interface JumpTargetSelectorProps {
  value: string;
  allSteps: Step[];
  excludeStepId: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}

export function JumpTargetSelector({
  value,
  allSteps,
  excludeStepId,
  onChange,
  onBlur,
}: JumpTargetSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options = getJumpTargetOptions(allSteps, excludeStepId);
  const filtered = search
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(search.toLowerCase()) ||
          o.description.toLowerCase().includes(search.toLowerCase()),
      )
    : options;

  const isResolved = !value || options.some((o) => o.id === value);
  const matched = options.find((o) => o.id === value);
  const displayValue = matched ? `${matched.label} ${matched.description}` : value;

  const select = useCallback(
    (id: string) => {
      onChange(id);
      setOpen(false);
      setSearch("");
      setActiveIdx(-1);
    },
    [onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        setOpen(true);
        setActiveIdx(0);
        e.preventDefault();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      setActiveIdx((i) => Math.max(i - 1, 0));
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (activeIdx >= 0 && activeIdx < filtered.length) {
        select(filtered[activeIdx].id);
      } else if (search) {
        onChange(search);
        setOpen(false);
        setSearch("");
      }
      e.preventDefault();
    } else if (e.key === "Escape") {
      setOpen(false);
      setSearch("");
      e.preventDefault();
    }
  };

  useEffect(() => {
    if (!open || activeIdx < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll<HTMLElement>(".jump-selector-option");
    items[activeIdx]?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div className="jump-selector" ref={wrapRef}>
      <div className={`jump-selector-input-wrap${!isResolved && value ? " unresolved" : ""}`}>
        {!isResolved && value && (
          <i className="bi bi-exclamation-triangle-fill jump-unresolved-icon" title="ジャンプ先が見つかりません" />
        )}
        <input
          className="form-control form-control-sm"
          value={open ? search : displayValue}
          placeholder="ジャンプ先を検索または直接入力"
          onChange={(e) => {
            setSearch(e.target.value);
            if (!open) setOpen(true);
            setActiveIdx(0);
          }}
          onFocus={() => {
            setOpen(true);
            setSearch("");
            setActiveIdx(0);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => onBlur?.(), 150)}
        />
        {value && (
          <button
            className="jump-selector-clear"
            onMouseDown={(e) => {
              e.preventDefault();
              onChange("");
              setSearch("");
            }}
            title="クリア"
          >
            <i className="bi bi-x" />
          </button>
        )}
      </div>
      {open && (
        <div className="jump-selector-dropdown" ref={listRef}>
          {filtered.length === 0 ? (
            search ? (
              <div
                className="jump-selector-option jump-selector-freetext"
                onMouseDown={() => {
                  onChange(search);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <i className="bi bi-pencil me-1" />「{search}」として設定
              </div>
            ) : (
              <div className="jump-selector-option-empty">候補がありません</div>
            )
          ) : (
            filtered.map((opt, i) => (
              <div
                key={opt.id}
                className={`jump-selector-option${i === activeIdx ? " active" : ""}`}
                onMouseDown={() => select(opt.id)}
              >
                <span className="jump-selector-option-label">{opt.label}</span>
                <span className="jump-selector-option-desc">{opt.description}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
