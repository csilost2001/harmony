/**
 * 式・条件・SQL の入力欄に共通の補完 (規約・自分・直前の工程の結果・入力・変数など)。
 *
 * 工程カードの「実行条件 (runIf)」「分岐条件」「代入式」「SQL」などが同じ補完を使うための組。
 */
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";
import type { ProcessFlow } from "../../types/v3";
import { convResolver } from "./convResolver";
import { ALL_PROCESS_FLOW_SCOPE_RESOLVERS } from "./processFlowScopeResolver";
import { thisResolver } from "./thisResolver";
import { selfResolver } from "./selfResolver";
import type { CompletionContext, Resolver } from "./types";

export const EXPRESSION_RESOLVERS: Resolver[] = [
  convResolver,
  thisResolver,
  selfResolver,
  ...ALL_PROCESS_FLOW_SCOPE_RESOLVERS,
];

export function expressionCtx(opts: {
  conventions?: ConventionsCatalog | null;
  flow?: ProcessFlow | null;
  stepId?: string;
}): CompletionContext {
  return {
    conventions: opts.conventions ?? null,
    flow: opts.flow ?? undefined,
    currentDocumentKind: "processFlow",
    ...(opts.stepId ? { currentSelfRef: { kind: "step" as const, id: opts.stepId } } : {}),
  };
}
