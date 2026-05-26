/**
 * v3 ProcessFlow builder — e2e テスト用 fixture 生成。
 *
 * defaults:
 * - createdAt/updatedAt: 固定値 "2026-05-08T00:00:00.000Z" (再現性)
 * - maturity: "draft"
 * - flowType: "other"  (#1263 Phase X1: kind → flowType に rename)
 * - actions: [] (空 ProcessFlow も schema valid)
 */

import type {
  ActionDefinition,
  Authoring,
  Context,
  Maturity,
  Mode,
  ProcessFlow,
  ProcessFlowId,
  ProcessFlowKind,
  ScreenId,
  Timestamp,
  Uuid,
} from "../../../src/types/v3";
import { deterministicUuid } from "../../helpers/realWorkspace";
import { normalizeToKebabId } from "./projectBuilder";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildProcessFlowOpts {
  id?: string;
  name?: string;
  flowType?: ProcessFlowKind;
  screenId?: string;
  maturity?: Maturity;
  mode?: Mode;
  actions?: ActionDefinition[];
  context?: Context;
  /** 設計プロセス用情報。default: undefined — 必要な spec のみ指定する。 */
  authoring?: Authoring;
}

export function buildProcessFlow(opts: BuildProcessFlowOpts = {}): ProcessFlow {
  // RFC #1284: id は kebab-case EntityId、uuid は不変識別子 (UUID v4)。
  const id = opts.id
    ? (normalizeToKebabId(opts.id) as unknown as ProcessFlowId)
    : ("test-flow" as unknown as ProcessFlowId);
  const uuid = opts.id
    // Round 6 Phase A: normalizeId → deterministicUuid に責務分離 (kebab-case 化 vs UUID v4 生成)
    ? (deterministicUuid(opts.id) as unknown as Uuid)
    : (crypto.randomUUID() as unknown as Uuid);

  return {
    $schema: "../../schemas/v3/process-flow.v3.schema.json",
    meta: {
      id,
      uuid,
      name: opts.name ?? "テスト処理フロー",
      flowType: opts.flowType ?? "other",
      maturity: opts.maturity ?? "draft",
      mode: opts.mode,
      screenId: opts.screenId
        ? (normalizeToKebabId(opts.screenId) as unknown as ScreenId)
        : undefined,
      createdAt: FIXED_TS,
      updatedAt: FIXED_TS,
    },
    context: opts.context,
    actions: opts.actions ?? [],
    ...(opts.authoring ? { authoring: opts.authoring } : {}),
  };
}
