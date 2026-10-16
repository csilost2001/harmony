/**
 * 一覧のグループ表示 (UI 改善提案 続編 第 6 弾 #102)。画面に依存しない純関数。
 * 並び (ソート) は、グループの中でそのまま保つ。グループの並びは、最初に出てきた順。
 */
export interface ListGroupOption<T> {
  id: string;
  /** メニューに出す名前 (例: カテゴリ) */
  label: string;
  /** 行が入るグループの名前。空文字は「(未設定)」にまとめる */
  keyOf: (item: T) => string;
}

export const UNSET_GROUP_LABEL = "(未設定)";

/** グループごとにまとめた並びにする。グループの中の順は変えない (安定) */
export function groupOrder<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const order: string[] = [];
  const buckets = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it) || UNSET_GROUP_LABEL;
    let b = buckets.get(k);
    if (!b) { b = []; buckets.set(k, b); order.push(k); }
    b.push(it);
  }
  return order.flatMap((k) => buckets.get(k)!);
}

export interface GroupSegment { key: string; start: number; count: number }

/** 並んでいる行を、同じグループが続く範囲に区切る (見出し行を挟む位置) */
export function groupSegments<T>(items: readonly T[], keyOf: (item: T) => string): GroupSegment[] {
  const out: GroupSegment[] = [];
  items.forEach((it, i) => {
    const k = keyOf(it) || UNSET_GROUP_LABEL;
    const last = out[out.length - 1];
    if (last && last.key === k) last.count++; else out.push({ key: k, start: i, count: 1 });
  });
  return out;
}

/** 成熟度 (draft / provisional / committed。未設定は draft) のグループ名 */
export function maturityGroupName(m: string | undefined | null): string {
  return m === "committed" ? "確定 (committed)" : m === "provisional" ? "暫定 (provisional)" : "下書き (draft)";
}
