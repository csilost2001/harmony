/**
 * v3 ProcessFlow builder — e2e テスト用 fixture 生成。
 *
 * defaults:
 * - createdAt/updatedAt: 固定値 "2026-05-08T00:00:00.000Z" (再現性)
 * - maturity: "draft"
 * - kind: "other"
 * - actions: [] (空 ProcessFlow も schema valid)
 */

import type {
  ActionDefinition,
  Context,
  Maturity,
  Mode,
  ProcessFlow,
  ProcessFlowId,
  ProcessFlowKind,
  ScreenId,
  Timestamp,
} from "../../../src/types/v3";
import { normalizeId } from "../../helpers/realWorkspace";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildProcessFlowOpts {
  id?: string;
  name?: string;
  kind?: ProcessFlowKind;
  screenId?: string;
  maturity?: Maturity;
  mode?: Mode;
  actions?: ActionDefinition[];
  context?: Context;
}

export function buildProcessFlow(opts: BuildProcessFlowOpts = {}): ProcessFlow {
  const id = opts.id
    ? (normalizeId(opts.id) as unknown as ProcessFlowId)
    : (crypto.randomUUID() as unknown as ProcessFlowId);

  return {
    $schema: "../../schemas/v3/process-flow.v3.schema.json",
    meta: {
      id,
      name: opts.name ?? "テスト処理フロー",
      kind: opts.kind ?? "other",
      maturity: opts.maturity ?? "draft",
      mode: opts.mode,
      screenId: opts.screenId
        ? (normalizeId(opts.screenId) as unknown as ScreenId)
        : undefined,
      createdAt: FIXED_TS,
      updatedAt: FIXED_TS,
    },
    context: opts.context,
    actions: opts.actions ?? [],
  };
}
