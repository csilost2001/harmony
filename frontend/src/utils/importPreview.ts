/**
 * 取り込みの予行で、「すでにあるテーブル」と、取り込む内容の違いを見せる (UI 改善提案 続編 第 9 弾 #174)。画面に依存しない純関数。
 * 取り込みは、既存の設計を上書きしない (列の id が変わると、外部キー・画面項目の参照が切れるため)。差を見せて、取り込まない理由を分かるようにする。
 * 比べるのは、カラム (物理名で対応づけ: 型・桁・NOT NULL・主キー・一意・自動採番・既定値) と、インデックスの物理名。
 */
import { compareSnapshots, type VersionCompare } from "./versionCompare";

interface ColLike { physicalName?: unknown; dataType?: unknown; length?: unknown; scale?: unknown; notNull?: unknown; primaryKey?: unknown; unique?: unknown; autoIncrement?: unknown; defaultValue?: unknown }
interface TableLike { columns?: ColLike[]; indexes?: Array<{ physicalName?: unknown }> }

const KEYS = ["dataType", "length", "scale", "notNull", "primaryKey", "unique", "autoIncrement", "defaultValue"] as const;

function project(t: TableLike): { columns: Array<Record<string, unknown>>; indexes: Array<{ id: string }> } {
  return {
    columns: (t.columns ?? []).map((c) => {
      const o: Record<string, unknown> = { id: String(c.physicalName ?? ""), physicalName: String(c.physicalName ?? "") };
      for (const k of KEYS) { const v = c[k]; if (v !== undefined && v !== null && v !== false && v !== "") o[k] = v; }
      return o;
    }),
    indexes: (t.indexes ?? []).map((i) => ({ id: String(i.physicalName ?? "") })),
  };
}

export interface DefinitionDiff { same: boolean; lines: string[]; compare: VersionCompare }

/** 既存の定義 → 取り込む定義 の違い */
export function compareTableDefinition(existing: TableLike, imported: TableLike): DefinitionDiff {
  const compare = compareSnapshots(project(existing), project(imported));
  return { same: compare.changes.length === 0, lines: compare.summary, compare };
}
