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
  Uuid,
  ViewColumn,
  ViewDefinition,
  ViewDefinitionId,
  ViewDefinitionKind,
  ViewQuery,
} from "../../../src/types/v3";
import { normalizeId } from "../../helpers/realWorkspace";
import { normalizeToKebabId } from "./projectBuilder";

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
  // RFC #1284: id は kebab-case EntityId、uuid は不変識別子 (UUID v4)。
  const id = opts.id
    ? (normalizeToKebabId(opts.id) as unknown as ViewDefinitionId)
    : ("test-view-def" as unknown as ViewDefinitionId);
  const uuid = opts.id
    ? (normalizeId(opts.id) as unknown as Uuid)
    : (crypto.randomUUID() as unknown as Uuid);

  // schema の oneOf: sourceTableId か query のどちらか一方が必須 (排他)
  // opts.query が指定された場合は Level 2/3 形式として query を使い sourceTableId は省略する
  // opts.query が未指定の場合は Level 1 形式として sourceTableId を設定する (kebab-case)
  const hasQuery = opts.query !== undefined;
  const sourceTableId = hasQuery
    ? undefined
    : opts.sourceTableId
      ? (normalizeToKebabId(opts.sourceTableId) as unknown as ViewDefinition["sourceTableId"])
      : ("source-table" as unknown as TableId);

  return {
    $schema: "../../schemas/v3/view-definition.v3.schema.json",
    id,
    uuid,
    name: opts.name ?? "テスト一覧 viewer",
    kind: opts.kind ?? "list",
    ...(hasQuery ? { query: opts.query } : { sourceTableId }),
    columns: opts.columns ?? [defaultViewColumn()],
    createdAt: FIXED_TS,
    updatedAt: FIXED_TS,
  };
}
