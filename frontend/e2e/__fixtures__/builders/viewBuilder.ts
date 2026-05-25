/**
 * v3 View builder — e2e テスト用 fixture 生成。
 *
 * defaults:
 * - createdAt/updatedAt: 固定値 "2026-05-08T00:00:00.000Z" (再現性)
 * - physicalName: "test_view"
 * - selectStatement: "SELECT id FROM test_table"
 * - outputColumns: 最低 1 件 (schema minItems: 1)
 */

import type {
  OutputColumn,
  PhysicalName,
  Timestamp,
  Uuid,
  View,
  ViewId,
} from "../../../src/types/v3";
import { normalizeId } from "../../helpers/realWorkspace";
import { normalizeToKebabId } from "./projectBuilder";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildViewOpts {
  id?: string;
  name?: string;
  physicalName?: string;
  selectStatement?: string;
  outputColumns?: OutputColumn[];
}

function defaultOutputColumn(): OutputColumn {
  return {
    physicalName: "id" as unknown as PhysicalName,
    name: "ID",
    dataType: "BIGINT",
  };
}

export function buildView(opts: BuildViewOpts = {}): View {
  // RFC #1284: id は kebab-case EntityId、uuid は不変識別子 (UUID v4)。
  const id = opts.id
    ? (normalizeToKebabId(opts.id) as unknown as ViewId)
    : ("test-view" as unknown as ViewId);
  const uuid = opts.id
    ? (normalizeId(opts.id) as unknown as Uuid)
    : (crypto.randomUUID() as unknown as Uuid);

  return {
    $schema: "../../schemas/v3/view.v3.schema.json",
    id,
    uuid,
    name: opts.name ?? "テストビュー",
    physicalName: (opts.physicalName ?? "test_view") as unknown as PhysicalName,
    selectStatement: opts.selectStatement ?? "SELECT id FROM test_table",
    outputColumns: opts.outputColumns ?? [defaultOutputColumn()],
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
  };
}
