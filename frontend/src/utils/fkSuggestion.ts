/**
 * 外部キーの候補を、カラム名とテーブル名の対応から探す。
 *
 *   1. 同じ物理名: 本テーブルの customer_id ↔ 参照先 (1 列の主キー) customers.customer_id   → 確度 高
 *   2. 「<テーブル名の単数形>_id」: orders.customer_id ↔ customers の主キー id            → 確度 中
 * 型が違う (数値と文字列) ものは候補にしない。主キー自身・既に外部キーにしている列・自分自身は除く。
 */
import type { Table, Column } from "../types/v3";

export interface FkSuggestion {
  column: Column;
  refTable: Table;
  refColumn: Column;
  confidence: "high" | "medium";
  reason: string;
}

const NUMERIC = new Set(["INTEGER", "BIGINT", "SMALLINT", "DECIMAL", "FLOAT"]);
const TEXT = new Set(["VARCHAR", "CHAR", "TEXT"]);

function family(dataType: string): string {
  const t = dataType.toUpperCase();
  if (NUMERIC.has(t)) return "numeric";
  if (TEXT.has(t)) return "text";
  return t;
}

/** テーブルの物理名から、単数形の候補を作る (customers → customer, categories → category, boxes → box)。 */
export function singularForms(name: string): string[] {
  const n = name.toLowerCase();
  const out = new Set<string>([n]);
  if (n.endsWith("ies") && n.length > 3) out.add(`${n.slice(0, -3)}y`);
  if (n.endsWith("es") && n.length > 2) out.add(n.slice(0, -2));
  if (n.endsWith("s") && n.length > 1) out.add(n.slice(0, -1));
  // 接頭辞 (m_ / t_ / tbl_) を外した形も
  for (const f of [...out]) {
    const m = f.match(/^(?:m|t|tbl|mst|trn)_(.+)$/);
    if (m) out.add(m[1]);
  }
  return [...out];
}

function singlePk(t: Table): Column | undefined {
  const pks = t.columns.filter((c) => c.primaryKey);
  if (pks.length === 1) return pks[0];
  const pkConstraint = (t.constraints ?? []).find((c) => c.kind === "primaryKey");
  if (pkConstraint && pkConstraint.columnIds.length === 1) return t.columns.find((c) => c.id === pkConstraint.columnIds[0]);
  return undefined;
}

export function suggestForeignKeys(table: Table, allTables: Table[]): FkSuggestion[] {
  const fkCols = new Set<string>();
  for (const c of table.constraints ?? []) if (c.kind === "foreignKey") for (const id of c.columnIds) fkCols.add(id);
  const pkCols = new Set(table.columns.filter((c) => c.primaryKey).map((c) => c.id as string));

  const result: FkSuggestion[] = [];
  const others = allTables.filter((t) => t.id !== table.id);
  for (const col of table.columns) {
    if (fkCols.has(col.id) || pkCols.has(col.id)) continue;
    const colName = col.physicalName.toLowerCase();
    let best: FkSuggestion | undefined;
    for (const ref of others) {
      const pk = singlePk(ref);
      if (!pk || family(pk.dataType) !== family(col.dataType)) continue;
      if (pk.physicalName.toLowerCase() === colName && colName !== "id") {
        best = { column: col, refTable: ref, refColumn: pk, confidence: "high", reason: `同じ名前の主キー (${ref.physicalName}.${pk.physicalName}) があります` };
        break;
      }
      if (colName.endsWith("_id") && !best) {
        const stem = colName.slice(0, -3);
        if (singularForms(ref.physicalName).includes(stem) && pk.physicalName.toLowerCase() === "id") {
          best = { column: col, refTable: ref, refColumn: pk, confidence: "medium", reason: `「${stem}_id」は ${ref.physicalName} の主キー (id) を指すことが多い名前です` };
        }
      }
    }
    if (best) result.push(best);
  }
  return result.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === "high" ? -1 : 1));
}
