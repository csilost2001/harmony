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
  TableId,
  Timestamp,
  ViewColumn,
  ViewDefinition,
  ViewDefinitionId,
  ViewDefinitionKind,
  ViewQuery,
} from "../../../src/types/v3";
import { normalizeId } from "../../helpers/realWorkspace";

const FIXED_TS = "2026-05-08T00:00:00.000Z" as unknown as Timestamp;

export interface BuildViewDefinitionOpts {
  id?: string;
  name?: string;
  kind?: ViewDefinitionKind;
  sourceTableId?: string;
  /** Level 2 (Structured) / Level 3 (Raw SQL) 形式。指定すると sourceTableId と排他になる。 */
  query?: ViewQuery;
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

  // schema の oneOf: sourceTableId か query のどちらか一方が必須 (排他)
  // opts.query が指定された場合は Level 2/3 形式として query を使い sourceTableId は省略する
  // opts.query が未指定の場合は Level 1 形式として sourceTableId を設定する (dummy UUID)
  const hasQuery = opts.query !== undefined;
  const sourceTableId = hasQuery
    ? undefined
    : opts.sourceTableId
      ? (normalizeId(opts.sourceTableId) as unknown as ViewDefinition["sourceTableId"])
      : (crypto.randomUUID() as unknown as TableId);

  return {
    $schema: "../../schemas/v3/view-definition.v3.schema.json",
    id,
    name: opts.name ?? "テスト一覧 viewer",
    kind: opts.kind ?? "list",
    ...(hasQuery ? { query: opts.query } : { sourceTableId }),
    columns: opts.columns ?? [defaultViewColumn()],
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
  };
}
