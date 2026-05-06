/**
 * ViewDefinition 3 レベル DSL のレベル検出 + 切替ヘルパー (#748)
 *
 * Level 1 (Simple)     — sourceTableId
 * Level 2 (Structured) — query.from + joins + where/groupBy/having/orderBy
 * Level 3 (Raw SQL)    — query.sql + parameterRefs
 *
 * sourceTableId と query は schema レベルで oneOf により排他。
 */

import type {
  ViewDefinition,
  ViewQueryStructured,
  ViewQueryRawSql,
} from "../../types/v3/view-definition";
import type { TableId } from "../../types/v3/common";

export type ViewLevel = 1 | 2 | 3;

/** ViewDefinition の現在の Level を判定する。
 *  query.sql があれば 3、query.from があれば 2、それ以外 (sourceTableId 想定) は 1。 */
export function detectLevel(vd: ViewDefinition): ViewLevel {
  const q = vd.query;
  if (q && "sql" in q && typeof (q as ViewQueryRawSql).sql === "string") return 3;
  if (q && "from" in q && (q as ViewQueryStructured).from) return 2;
  return 1;
}

/** 既に存在する alias を避けて、テーブル名から alias 候補を生成する。
 *  ベースは英小文字 1 文字 (テーブル名先頭) で、衝突時は数字 suffix。 */
export function suggestAlias(tableName: string | undefined, used: Set<string>): string {
  const base = (tableName ?? "t")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/^_+/, "");
  const first = base.match(/^[a-z]/) ? base[0] : "t";
  if (!used.has(first)) return first;
  let i = 2;
  while (used.has(`${first}${i}`)) i++;
  return `${first}${i}`;
}

/**
 * Level 切替時に schema oneOf を満たすよう sourceTableId / query を排他書き換え。
 *
 * 既存の columns / sortDefaults / filterDefaults / pageSize / groupBy は維持する。
 * 切替候補テーブル ID:
 *  - target=1 (Simple): query.from.tableId (L2 from) → columns[0].tableColumnRef.tableId (L3 from) → 旧 sourceTableId
 *  - target=2 (Structured): sourceTableId (L1) → columns[0].tableColumnRef.tableId (L3) → 空
 *  - target=3 (Raw SQL): 空の SQL + parameterRefs[]
 *
 * tableName は alias 推定用 (target=2 のときのみ使う)。
 */
export function migrateToLevel(
  vd: ViewDefinition,
  target: ViewLevel,
  tableName: (id: string) => string | undefined,
): ViewDefinition {
  const cur = detectLevel(vd);
  if (cur === target) return vd;

  const next: ViewDefinition = { ...vd };
  next.sourceTableId = undefined;
  next.query = undefined;

  if (target === 1) {
    let sid: string | undefined;
    if (cur === 2) {
      const sq = vd.query as ViewQueryStructured | undefined;
      sid = sq?.from?.tableId as string | undefined;
    } else if (cur === 3) {
      sid = vd.columns?.[0]?.tableColumnRef?.tableId as string | undefined;
    } else {
      sid = vd.sourceTableId as string | undefined;
    }
    next.sourceTableId = (sid ?? "") as TableId;
  } else if (target === 2) {
    let fromTableId: string | undefined;
    if (cur === 1) fromTableId = vd.sourceTableId as string | undefined;
    else if (cur === 3) fromTableId = vd.columns?.[0]?.tableColumnRef?.tableId as string | undefined;
    const alias = suggestAlias(fromTableId ? tableName(fromTableId) : undefined, new Set());
    next.query = {
      from: { tableId: (fromTableId ?? "") as TableId, alias },
    } satisfies ViewQueryStructured;
  } else {
    next.query = {
      sql: "",
      parameterRefs: [],
    } satisfies ViewQueryRawSql;
  }

  return next;
}
