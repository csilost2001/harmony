import { useMemo, useState } from "react";
import { applyTermHint, termVariantHints } from "../../utils/termVariants";
import "../../styles/columnImpact.css";

interface Props {
  value: string;
  /** ほかの設計で使われている名前 (この欄の値そのものは含めない) */
  known: readonly string[];
  onApply: (next: string) => void;
  disabled?: boolean;
}

/** 入力欄の下に、書き方のゆれ (ユーザ / ユーザー) をそっと示す。「このまま」はこの画面を開いている間だけ覚える (続編 第 8 弾 #160) */
export function TermVariantHint({ value, known, onApply, disabled }: Props) {
  const [ignored, setIgnored] = useState<ReadonlySet<string>>(new Set());
  const hints = useMemo(() => termVariantHints(value, known).filter((h) => !ignored.has(h.from)), [value, known, ignored]);
  if (disabled || hints.length === 0) return null;
  const h = hints[0];
  return (
    <span className="term-variant-hint" data-testid="term-variant-hint" role="note">
      <i className="bi bi-lightbulb" /> ほかでは「{h.to}」と書かれています ({h.count} 件)
      <button type="button" className="term-variant-btn" onClick={() => onApply(applyTermHint(value, h))} data-testid="term-variant-apply">「{h.to}」にそろえる</button>
      <button type="button" className="term-variant-btn" onClick={() => setIgnored(new Set([...ignored, h.from]))} data-testid="term-variant-ignore">このまま</button>
    </span>
  );
}
