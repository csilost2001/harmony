/**
 * テーブルのカラムを貼り付けるときの下ごしらえ (純関数)。同じテーブルへのコピーでも、別のテーブルからのコピーでも、
 * - ID: 既存のカラムと重ならない新しい ID を付ける (そのまま貼ると、同じ ID の行が 2 つになる)
 * - 物理名: 既存のカラムと同じなら `_copy` を付ける (重なる間は付け足す)
 * - 別のテーブルから貼るとき、貼り先にすでに主キーがあれば、貼るカラムの主キー・自動採番の印は外す (主キーが 2 つになる)
 */
import type { Column, PhysicalName } from "../types/v3";

export interface ColumnPastePlan {
  columns: Column[];
  /** 物理名を付け替えたもの (元の名前 → 新しい名前) */
  renamed: Array<{ from: string; to: string }>;
  /** 主キー・自動採番の印を外したカラムの数 */
  droppedKeys: number;
}

/** 貼ると物理名が重なるカラムの物理名 (確認の文言に使う) */
export function conflictingPhysicalNames(existing: readonly Column[], pasted: readonly Column[]): string[] {
  const names = new Set(existing.map((c) => c.physicalName as string));
  return pasted.map((c) => c.physicalName as string).filter((n, i, a) => names.has(n) && a.indexOf(n) === i);
}

export function planColumnPaste(existing: readonly Column[], pasted: readonly Column[], foreign: boolean): ColumnPastePlan {
  const ids = new Set(existing.map((c) => c.id as string));
  const names = new Set(existing.map((c) => c.physicalName as string));
  const hasPk = existing.some((c) => c.primaryKey);
  const renamed: ColumnPastePlan["renamed"] = [];
  let droppedKeys = 0;
  let n = existing.length + 1;
  const columns = pasted.map((src) => {
    while (ids.has(`col-${String(n).padStart(2, "0")}`)) n++;
    const id = `col-${String(n).padStart(2, "0")}`;
    ids.add(id);
    let physicalName = src.physicalName as string;
    if (names.has(physicalName)) {
      let candidate = `${physicalName}_copy`;
      while (names.has(candidate)) candidate += "_copy";
      renamed.push({ from: physicalName, to: candidate });
      physicalName = candidate;
    }
    names.add(physicalName);
    const col: Column = { ...src, id: id as Column["id"], physicalName: physicalName as PhysicalName };
    if (foreign && hasPk && (col.primaryKey || col.autoIncrement)) {
      droppedKeys++;
      delete col.primaryKey;
      delete col.autoIncrement;
    }
    return col;
  });
  return { columns, renamed, droppedKeys };
}
