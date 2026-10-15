import { useReferenceCompletion } from "../../hooks/useReferenceCompletion";
import type { CompletionContext, Resolver } from "../../utils/reference-completer/types";
import { CompletionPopup, COMPLETION_TITLE } from "./CompletionPopup";

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
  title?: string;
  /** 候補一覧のアクセシビリティ上の名前 (既定 "補完候補")。 */
  popupLabel?: string;
}

/**
 * 統合 reference 補完ポップアップ付き textarea。
 * ReferenceCompletionInput の textarea 版 (Phase 3 / #1255)。Enter は改行のため、確定は Tab。
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
  title,
  popupLabel,
}: ReferenceCompletionTextareaProps) {
  const { inputRef, candidates, isOpen, safeIndex, pick, handlers } = useReferenceCompletion<HTMLTextAreaElement>({
    value,
    onValueChange,
    onCommit,
    resolvers,
    ctx,
    pickOnEnter: false,
  });

  return (
    <div style={{ position: "relative" }}>
      <textarea
        ref={inputRef}
        className={className}
        style={style}
        value={value}
        placeholder={placeholder}
        title={title ?? COMPLETION_TITLE}
        autoComplete="off"
        disabled={disabled}
        rows={rows}
        {...handlers}
      />
      {isOpen && <CompletionPopup candidates={candidates} activeIndex={safeIndex} onPick={pick} ariaLabel={popupLabel} />}
    </div>
  );
}
