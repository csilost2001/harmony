/**
 * v3 ScreenFlowPositions builder — e2e テスト用 fixture 生成。
 *
 * defaults:
 * - positions: {} (空マップ、schema required だが値は空 object OK)
 * - updatedAt: 固定値 "2026-05-08T00:00:00.000Z" (再現性)
 */

import type {
  ScreenFlowPositions,
  Timestamp,
  TransitionLayout,
  Position,
} from "../../../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildScreenFlowPositionsOpts {
  positions?: Record<string, Position>;
  transitions?: Record<string, TransitionLayout>;
}

export function buildScreenFlowPositions(opts: BuildScreenFlowPositionsOpts = {}): ScreenFlowPositions {
  return {
    $schema: "../../schemas/v3/screen-flow-positions.v3.schema.json",
    positions: opts.positions ?? {},
    transitions: opts.transitions,
    updatedAt: FIXED_TS,
  };
}

