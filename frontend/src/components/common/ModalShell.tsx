import { useRef, type CSSProperties, type ReactNode } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";

interface Props {
  /** Esc で呼ぶ (閉じる・取り消す) */
  onEscape: () => void;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  "data-testid"?: string;
  ariaLabel?: string;
  /** 中のクリックを外 (背景) へ伝えない、などに使う */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
}

/** ダイアログの外枠。フォーカスを中に閉じ込め (Tab で循環)、Esc で閉じ、閉じたら元の場所へフォーカスを戻す。 */
export function ModalShell({ onEscape, className, style, children, "data-testid": testId, ariaLabel, onClick }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true, onEscape);
  return (
    <div ref={ref} className={className} style={style} role="dialog" aria-modal="true" aria-label={ariaLabel} onClick={onClick} data-testid={testId}>
      {children}
    </div>
  );
}
