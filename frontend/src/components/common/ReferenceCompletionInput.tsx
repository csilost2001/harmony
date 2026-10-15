import { useReferenceCompletion } from "../../hooks/useReferenceCompletion";
import type { CompletionContext, Resolver } from "../../utils/reference-completer/types";
import { CompletionPopup, COMPLETION_TITLE } from "./CompletionPopup";

interface ReferenceCompletionInputProps {
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
  title?: string;
  /** 候補一覧のアクセシビリティ上の名前 (既定 "補完候補")。 */
  popupLabel?: string;
}

/**
 * 統合 reference 補完ポップアップ付き input。
 *
 * 渡された resolvers / ctx に基づいて補完候補を計算し、
 * ↑↓ / Enter / Tab / Esc / Ctrl+Space でポップアップ操作ができる (日本語の変換中は何もしない)。
 */
export function ReferenceCompletionInput({
  value,
  onValueChange,
  onCommit,
  resolvers,
  ctx,
  className,
  style,
  placeholder,
  disabled,
  title,
  popupLabel,
}: ReferenceCompletionInputProps) {
  const { inputRef, candidates, isOpen, safeIndex, pick, handlers } = useReferenceCompletion<HTMLInputElement>({
    value,
    onValueChange,
    onCommit,
    resolvers,
    ctx,
    pickOnEnter: true,
  });

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        className={className}
        style={style}
        value={value}
        placeholder={placeholder}
        title={title ?? COMPLETION_TITLE}
        autoComplete="off"
        disabled={disabled}
        {...handlers}
      />
      {isOpen && <CompletionPopup candidates={candidates} activeIndex={safeIndex} onPick={pick} ariaLabel={popupLabel} />}
    </div>
  );
}
