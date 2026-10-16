import { useReferenceCompletion } from "../../hooks/useReferenceCompletion";
import type { CompletionContext, Resolver } from "../../utils/reference-completer/types";
import { CompletionPopup, COMPLETION_TITLE } from "./CompletionPopup";
import { FieldHint } from "./FieldHint";

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
  /** 式・条件の欄 (書き間違いの指摘と、平文の言い直しを出す) */
  expression?: boolean;
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
  expression,
}: ReferenceCompletionTextareaProps) {
  const { inputRef, candidates, isOpen, safeIndex, pick, handlers, hints, preview, applyFix } = useReferenceCompletion<HTMLTextAreaElement>({
    value,
    onValueChange,
    onCommit,
    resolvers,
    ctx,
    pickOnEnter: false,
    expression,
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
        aria-invalid={hints.length > 0 ? true : undefined}
        rows={rows}
        {...handlers}
      />
      {isOpen && <CompletionPopup candidates={candidates} activeIndex={safeIndex} onPick={pick} ariaLabel={popupLabel} />}
      {hints.map((h, i) => <FieldHint key={i} hint={h} onFix={h.fix ? () => applyFix(h.fix!) : undefined} testId="reference-hint" />)}
      {preview && <div className="field-preview" data-testid="condition-preview">{preview}</div>}
    </div>
  );
}
