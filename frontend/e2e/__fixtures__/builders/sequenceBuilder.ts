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
  Uuid,
} from "../../../src/types/v3";
import { deterministicUuid } from "../../helpers/realWorkspace";
import { normalizeToKebabId } from "./projectBuilder";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildSequenceOpts {
  id?: string;
  name?: string;
  physicalName?: string;
  conventionRef?: string;
}

export function buildSequence(opts: BuildSequenceOpts = {}): Sequence {
  // RFC #1284: id は kebab-case EntityId、uuid は不変識別子 (UUID v4)。
  const id = opts.id
    ? (normalizeToKebabId(opts.id) as unknown as SequenceId)
    : ("test-sequence" as unknown as SequenceId);
  const uuid = opts.id
    // Round 6 Phase A: normalizeId → deterministicUuid に責務分離 (kebab-case 化 vs UUID v4 生成)
    ? (deterministicUuid(opts.id) as unknown as Uuid)
    : (crypto.randomUUID() as unknown as Uuid);

  return {
    $schema: "../../schemas/v3/sequence.v3.schema.json",
    id,
    uuid,
    name: opts.name ?? "テストシーケンス",
    physicalName: (opts.physicalName ?? "seq_test") as unknown as PhysicalName,
    conventionRef: opts.conventionRef,
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
  };
}
