/**
 * v3 ScreenLayout builder — e2e テスト用 fixture 生成。
 *
 * defaults:
 * - positions: {} (空マップ、schema required だが値は空 object OK)
 * - updatedAt: 固定値 "2026-05-08T00:00:00.000Z" (再現性)
 */

import type {
  ScreenLayout,
  Timestamp,
  TransitionLayout,
  Position,
} from "../../../src/types/v3";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildScreenLayoutOpts {
  nodes?: Record<string, Position>;
  edges?: Record<string, TransitionLayout>;
}

export function buildScreenLayout(opts: BuildScreenLayoutOpts = {}): ScreenLayout {
  return {
    $schema: "../../schemas/v3/screen-layout.v3.schema.json",
    positions: opts.nodes ?? {},
    transitions: opts.edges,
    updatedAt: FIXED_TS,
  };
}
