/**
 * v3 Table builder — e2e テスト用 fixture 生成。
 *
 * defaults:
 * - createdAt/updatedAt: 固定値 "2026-05-08T00:00:00.000Z" (再現性)
 * - maturity: "draft"
 * - physicalName: "test_table"
 * - columns: 最低 1 件 (schema required)
 */

import type {
  Column,
  Index,
  LocalId,
  Maturity,
  PhysicalName,
  Table,
  TableId,
  Timestamp,
} from "../../../src/types/v3";
import { normalizeId } from "../../helpers/realWorkspace";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildTableOpts {
  id?: string;
  name?: string;
  physicalName?: string;
  category?: string;
  maturity?: Maturity;
  columns?: Column[];
  indexes?: Index[];
}

function defaultColumn(): Column {
  return {
    id: "col-01" as unknown as LocalId,
    physicalName: "id" as unknown as PhysicalName,
    name: "ID",
    dataType: "BIGINT",
    notNull: true,
    primaryKey: true,
    autoIncrement: true,
  };
}

export function buildTable(opts: BuildTableOpts = {}): Table {
  const id = opts.id
    ? (normalizeId(opts.id) as unknown as TableId)
    : (crypto.randomUUID() as unknown as TableId);

  return {
    $schema: "../../schemas/v3/table.v3.schema.json",
    id,
    name: opts.name ?? "テストテーブル",
    physicalName: (opts.physicalName ?? "test_table") as unknown as PhysicalName,
    category: opts.category,
    maturity: opts.maturity ?? "draft",
    columns: opts.columns ?? [defaultColumn()],
    indexes: opts.indexes,
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
  };
}
