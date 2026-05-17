import { useEffect, useRef } from "react";

/**
 * 高さが入力内容に追従する textarea。
 * StepCard 内で複数箇所から呼ばれていたヘルパーを分離。
 *
 * 元: components/process-flow/StepCard.tsx (#1145 で分離)
 */
export function AutoResizeTextarea({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [value]);
  return (
    <textarea
      ref={ref}
      className={className ?? "form-control form-control-sm auto-resize"}
      value={value}
      rows={1}
      onChange={onChange}
      onBlur={onBlur}
      placeholder={placeholder}
    />
  );
}
