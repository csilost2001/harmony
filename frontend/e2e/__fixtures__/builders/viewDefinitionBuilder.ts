/**
 * v3 ViewDefinition builder — e2e テスト用 fixture 生成。
 *
 * defaults:
 * - createdAt/updatedAt: 固定値 "2026-05-08T00:00:00.000Z" (再現性)
 * - kind: "list"
 * - columns: 最低 1 件 (schema required + minItems: 1)
 */

import type {
  Identifier,
  Timestamp,
  ViewColumn,
  ViewDefinition,
  ViewDefinitionId,
  ViewDefinitionKind,
} from "../../../src/types/v3";
import { normalizeId } from "../../helpers/realWorkspace";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildViewDefinitionOpts {
  id?: string;
  name?: string;
  kind?: ViewDefinitionKind;
  sourceTableId?: string;
  columns?: ViewColumn[];
}

function defaultViewColumn(): ViewColumn {
  return {
    name: "id" as unknown as Identifier,
    type: "integer",
  };
}

export function buildViewDefinition(opts: BuildViewDefinitionOpts = {}): ViewDefinition {
  const id = opts.id
    ? (normalizeId(opts.id) as unknown as ViewDefinitionId)
    : (crypto.randomUUID() as unknown as ViewDefinitionId);

  return {
    $schema: "../../schemas/v3/view-definition.v3.schema.json",
    id,
    name: opts.name ?? "テスト一覧 viewer",
    kind: opts.kind ?? "list",
    sourceTableId: opts.sourceTableId
      ? (normalizeId(opts.sourceTableId) as unknown as ViewDefinition["sourceTableId"])
      : undefined,
    columns: opts.columns ?? [defaultViewColumn()],
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
  };
}
