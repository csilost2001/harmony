import type { ConventionsCatalog } from "../../schemas/conventionsValidator";
import type { ProcessFlow } from "../../types/v3";
import { convResolver } from "../../utils/reference-completer/convResolver";
import { EXPRESSION_RESOLVERS, expressionCtx } from "../../utils/reference-completer/expressionPreset";
import { ReferenceCompletionInput } from "./ReferenceCompletionInput";

interface ConvCompletionInputProps {
  value: string;
  onValueChange: (v: string) => void;
  onCommit?: () => void;
  conventions: ConventionsCatalog | null;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
  disabled?: boolean;
  /**
   * 編集中の処理フロー。渡すと、規約 (@conv) に加えて、直前の工程の結果・入力・変数・
   * 自分・この設計の参照も候補になる (式・条件の欄用)。渡さなければ @conv だけ。
   */
  flow?: ProcessFlow | null;
  /** 編集中の工程の id (@self の補完用)。 */
  stepId?: string;
}

/**
 * 式の入力欄 (補完ポップアップ付き)。`@conv.` 入力でカテゴリ一覧、`@conv.currency.` で key 一覧を表示する。
 * 操作は ReferenceCompletionInput と同じ (↑↓ で選択、Tab / Enter で確定、Esc で閉じる、Ctrl+Space で開く)。
 */
export function ConvCompletionInput({ conventions, flow, stepId, ...rest }: ConvCompletionInputProps) {
  if (flow) {
    return (
      <ReferenceCompletionInput
        {...rest}
        resolvers={EXPRESSION_RESOLVERS}
        ctx={expressionCtx({ conventions, flow, stepId })}
        expression
      />
    );
  }
  return (
    <ReferenceCompletionInput
      {...rest}
      resolvers={[convResolver]}
      ctx={{ conventions }}
      popupLabel="@conv 補完候補"
    />
  );
}
