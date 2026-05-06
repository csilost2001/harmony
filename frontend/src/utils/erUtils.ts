/**
 * erUtils.ts (v3, #556)
 * ER 図のリレーション導出・Mermaid 生成・自動配置ユーティリティ。
 *
 * v3 schema 整合:
 * - 物理 FK は Constraint.foreignKey から (Column.foreignKey は廃止)
 * - referencedTableId (Uuid) → physicalName 解決は allTables から逆引き
 * - LogicalRelation の sourceColumnId / targetColumnId (LocalId) → Column.physicalName 解決
 */
import type {
  Table,
  ErLayout,
  LogicalRelation,
  ForeignKeyConstraint,
} from "../types/v3";

/** ER 図描画用の統合リレーション型 (Designer 内部用)。 */
export type ErCardinality = "one-to-one" | "one-to-many" | "many-to-many";

export const CARDINALITY_LABELS: Record<ErCardinality, string> = {
  "one-to-many": "1:N",
  "one-to-one": "1:1",
  "many-to-many": "N:N",
};

export interface ErRelation {
  id: string;
  sourceTableId: string;
  /** 参照元テーブル物理名 (描画用)。 */
  sourceTableName: string;
  /** 参照元カラム物理名 (描画用、未解決なら undefined)。 */
  sourceColumnName?: string;
  targetTableId: string;
  targetTableName: string;
  targetColumnName?: string;
  cardinality: ErCardinality;
  /** true なら物理 FK (Constraint.foreignKey 由来)、false なら論理 (ErLayout.logicalRelations 由来)。 */
  physical: boolean;
  label?: string;
}

/** Column.id (LocalId) → physicalName 解決。 */
function resolveColumnPhysical(table: Table, columnId: string | undefined): string | undefined {
  if (!columnId) return undefined;
  return table.columns.find((c) => c.id === columnId)?.physicalName;
}

/** テーブル定義群から物理 FK リレーションを導出 (Constraint.foreignKey 由来)。 */
export function derivePhysicalRelations(tables: Table[]): ErRelation[] {
  const relations: ErRelation[] = [];
  const tableIdMap = new Map(tables.map((t) => [t.id, t]));

  for (const table of tables) {
    for (const c of table.constraints ?? []) {
      if (c.kind !== "foreignKey") continue;
      const fk = c as ForeignKeyConstraint;
      const target = tableIdMap.get(fk.referencedTableId);
      if (!target) continue;
      // 描画は単一カラム代表 (複合 FK の場合は先頭ペア)。詳細は ER 図本体に出さない設計。
      const ownColId = fk.columnIds[0];
      const refColId = fk.referencedColumnIds[0];
      relations.push({
        id: `fk-${table.id}-${c.id}`,
        sourceTableId: table.id,
        sourceTableName: table.physicalName,
        sourceColumnName: resolveColumnPhysical(table, ownColId),
        targetTableId: target.id,
        targetTableName: target.physicalName,
        targetColumnName: resolveColumnPhysical(target, refColId),
        cardinality: "one-to-many",
        physical: true,
      });
    }
  }
  return relations;
}

/** 論理リレーションを ErRelation 形式に変換。 */
export function convertLogicalRelations(
  logicals: LogicalRelation[],
  tables: Table[],
): ErRelation[] {
  const tableIdMap = new Map(tables.map((t) => [t.id, t]));
  return logicals
    .map((lr): ErRelation | null => {
      const src = tableIdMap.get(lr.sourceTableId);
      const tgt = tableIdMap.get(lr.targetTableId);
      if (!src || !tgt) return null;
      return {
        id: lr.id,
        sourceTableId: lr.sourceTableId,
        sourceTableName: src.physicalName,
        sourceColumnName: resolveColumnPhysical(src, lr.sourceColumnId),
        targetTableId: lr.targetTableId,
        targetTableName: tgt.physicalName,
        targetColumnName: resolveColumnPhysical(tgt, lr.targetColumnId),
        cardinality: lr.cardinality,
        physical: false,
        label: lr.label,
      };
    })
    .filter((r): r is ErRelation => r !== null);
}

/** 全リレーション (物理 FK + 論理) を統合。 */
export function getAllRelations(
  tables: Table[],
  layout: ErLayout | null,
): ErRelation[] {
  const physical = derivePhysicalRelations(tables);
  const logical = layout?.logicalRelations
    ? convertLogicalRelations(layout.logicalRelations, tables)
    : [];
  return [...physical, ...logical];
}

/** Mermaid ER 図を生成。 */
export function generateErMermaid(
  tables: Table[],
  relations: ErRelation[],
): string {
  if (tables.length === 0) return "erDiagram\n    %% テーブルなし";

  const lines: string[] = ["erDiagram"];
  // 物理 FK のソースカラム集合 (FK marker 表示用)
  const fkColIds = new Set<string>();
  for (const t of tables) {
    for (const c of t.constraints ?? []) {
      if (c.kind === "foreignKey") {
        for (const colId of c.columnIds) {
          fkColIds.add(`${t.id}::${colId}`);
        }
      }
    }
  }

  for (const table of tables) {
    lines.push(`    ${table.physicalName} {`);
    for (const col of table.columns) {
      const markers: string[] = [];
      if (col.primaryKey) markers.push("PK");
      if (fkColIds.has(`${table.id}::${col.id}`)) markers.push("FK");
      if (col.unique && !col.primaryKey) markers.push("UK");
      const marker = markers.length > 0 ? ` ${markers.join(",")}` : "";
      const comment = col.name ? ` "${col.name}"` : "";
      // dataType が拡張参照 (`oracle:VARCHAR2` 等) の場合は ":" を含むため、Mermaid 用に prefix を剥がす
      const dt = typeof col.dataType === "string" && col.dataType.includes(":")
        ? (col.dataType.split(":")[1] ?? col.dataType)
        : col.dataType;
      lines.push(`        ${dt} ${col.physicalName}${marker}${comment}`);
    }
    lines.push("    }");
  }

  for (const rel of relations) {
    const cardStr = rel.cardinality === "one-to-one"
      ? "||--||"
      : rel.cardinality === "many-to-many"
        ? "}|--|{"
        : "||--o{";
    const label = rel.sourceColumnName || rel.label || "";
    if (rel.physical) {
      lines.push(`    ${rel.targetTableName} ${cardStr} ${rel.sourceTableName} : "${label}"`);
    } else {
      const suffix = label ? ` (論理)` : "論理";
      lines.push(`    ${rel.targetTableName} ${cardStr} ${rel.sourceTableName} : "${label}${suffix}"`);
    }
  }

  return lines.join("\n");
}

/** FK 依存関係に基づく自動配置。被参照テーブル (親) を上、参照元 (子) を下に。 */
export function autoLayout(
  tables: Table[],
  relations: ErRelation[],
): Record<string, { x: number; y: number }> {
  if (tables.length === 0) return {};

  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();
  for (const t of tables) {
    inDegree.set(t.id, 0);
    outEdges.set(t.id, []);
  }
  for (const rel of relations) {
    inDegree.set(rel.sourceTableId, (inDegree.get(rel.sourceTableId) ?? 0) + 1);
    outEdges.get(rel.targetTableId)?.push(rel.sourceTableId);
  }

  const layers: string[][] = [];
  const assigned = new Set<string>();

  // FK を持たないテーブル (マスタ系) をルートに。FK は constraints から数える。
  const fkCount = new Map<string, number>();
  for (const t of tables) {
    const count = (t.constraints ?? []).filter((c) => c.kind === "foreignKey").length;
    fkCount.set(t.id, count);
  }

  let roots: string[] = tables.filter((t) => (fkCount.get(t.id) ?? 0) === 0).map((t) => t.id as string);
  if (roots.length === 0) roots = [tables[0].id as string];

  let current: string[] = roots;
  while (current.length > 0) {
    layers.push(current);
    current.forEach((id) => assigned.add(id));
    const next: string[] = [];
    for (const id of current) {
      for (const childId of outEdges.get(id) ?? []) {
        if (!assigned.has(childId)) {
          next.push(childId);
          assigned.add(childId);
        }
      }
    }
    current = [...new Set(next)];
  }

  for (const t of tables) {
    if (!assigned.has(t.id)) {
      if (layers.length === 0) layers.push([]);
      layers[layers.length - 1].push(t.id);
    }
  }

  const NODE_WIDTH = 240;
  const NODE_GAP_X = 80;
  const NODE_GAP_Y = 120;
  const positions: Record<string, { x: number; y: number }> = {};

  for (let row = 0; row < layers.length; row++) {
    const layer = layers[row];
    const totalWidth = layer.length * NODE_WIDTH + (layer.length - 1) * NODE_GAP_X;
    const startX = -totalWidth / 2;
    for (let col = 0; col < layer.length; col++) {
      positions[layer[col]] = {
        x: startX + col * (NODE_WIDTH + NODE_GAP_X),
        y: row * (200 + NODE_GAP_Y),
      };
    }
  }

  return positions;
}
