/**
 * 入力欄の直下に出す、その場の指摘と直し方 (UI 改善提案 第 5 弾 #81・#100)。
 * 欄は aria-invalid にして、F8 (次の要確認) の対象にもなる。直した値の案があれば、ボタン 1 つで採用できる。
 */
import type { IdentifierHint } from "../../utils/identifierHints";

export function FieldHint({ hint, onFix, testId }: { hint: IdentifierHint | null; onFix?: (value: string) => void; testId?: string }) {
  if (!hint) return null;
  return (
    <div className="field-hint" role="status" data-testid={testId ?? "field-hint"}>
      <span>{hint.message}</span>
      {hint.fix && onFix && (
        <button type="button" className="field-hint-fix" onClick={() => onFix(hint.fix!)} data-testid="field-hint-fix">「{hint.fix}」に直す</button>
      )}
    </div>
  );
}
