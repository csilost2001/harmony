/**
 * v3 Sequence builder — e2e テスト用 fixture 生成。
 *
 * defaults:
 * - createdAt/updatedAt: 固定値 "2026-05-08T00:00:00.000Z" (再現性)
 * - physicalName: "seq_test"
 */

import type {
  PhysicalName,
  Sequence,
  SequenceId,
  Timestamp,
} from "../../../src/types/v3";
import { normalizeId } from "../../helpers/realWorkspace";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildSequenceOpts {
  id?: string;
  name?: string;
  physicalName?: string;
  conventionRef?: string;
}

export function buildSequence(opts: BuildSequenceOpts = {}): Sequence {
  const id = opts.id
    ? (normalizeId(opts.id) as unknown as SequenceId)
    : (crypto.randomUUID() as unknown as SequenceId);

  return {
    $schema: "../../schemas/v3/sequence.v3.schema.json",
    id,
    name: opts.name ?? "テストシーケンス",
    physicalName: (opts.physicalName ?? "seq_test") as unknown as PhysicalName,
    conventionRef: opts.conventionRef,
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
  };
}
