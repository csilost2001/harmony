/**
 * v3 ActionDefinition builder — e2e テスト用 fixture 生成。
 *
 * ActionDefinition は ProcessFlow.actions[] の要素。
 * required: id (LocalId) / name / trigger / steps
 */

import type {
  ActionDefinition,
  ActionTrigger,
  LocalId,
  Maturity,
  Step,
} from "../../../src/types/v3";

export interface BuildActionOpts {
  id?: string;
  name?: string;
  trigger?: ActionTrigger;
  maturity?: Maturity;
  steps?: Step[];
}

export function buildAction(opts: BuildActionOpts = {}): ActionDefinition {
  return {
    id: (opts.id ?? "action-01") as unknown as LocalId,
    name: opts.name ?? "テストアクション",
    trigger: opts.trigger ?? "click",
    maturity: opts.maturity ?? "draft",
    steps: opts.steps ?? [],
  };
}
