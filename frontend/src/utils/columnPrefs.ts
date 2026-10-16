/**
 * 一覧の列の幅・表示・並びを、利用者ごと・画面ごとに覚える (UI 改善提案 第 3 弾 #47)。
 * 画面に依存しない純関数と、ブラウザ (localStorage) への読み書き。原本 (設計の JSON) には書かない。
 */
export interface ColumnPrefs {
  /** 列の key → 幅 (px)。無い列は自動 */
  widths: Record<string, number>;
  /** 隠す列の key */
  hidden: string[];
  /** 列の key の並び。無い列は、元の並びのまま後ろへ */
  order: string[];
}

export const MIN_COLUMN_WIDTH = 48;
export const MAX_COLUMN_WIDTH = 800;
const STORAGE_PREFIX = "harmony.listColumns.";

export const emptyPrefs = (): ColumnPrefs => ({ widths: {}, hidden: [], order: [] });

export const isDefaultPrefs = (p: ColumnPrefs): boolean => Object.keys(p.widths).length === 0 && p.hidden.length === 0 && p.order.length === 0;

/** 保存してある設定を読む (壊れた値・無い値は、既定) */
export function loadColumnPrefs(key: string): ColumnPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return emptyPrefs();
    const v = JSON.parse(raw) as Partial<ColumnPrefs>;
    const widths: Record<string, number> = {};
    for (const [k, w] of Object.entries(v.widths ?? {})) if (typeof w === "number" && Number.isFinite(w)) widths[k] = clampWidth(w);
    return {
      widths,
      hidden: Array.isArray(v.hidden) ? v.hidden.filter((x): x is string => typeof x === "string") : [],
      order: Array.isArray(v.order) ? v.order.filter((x): x is string => typeof x === "string") : [],
    };
  } catch {
    return emptyPrefs();
  }
}

export function saveColumnPrefs(key: string, prefs: ColumnPrefs): void {
  try {
    if (isDefaultPrefs(prefs)) window.localStorage.removeItem(STORAGE_PREFIX + key);
    else window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(prefs));
  } catch {
    // 保存できない環境 (プライベートモードなど) では、その場だけの設定にする
  }
}

export const clampWidth = (px: number): number => Math.min(Math.max(Math.round(px), MIN_COLUMN_WIDTH), MAX_COLUMN_WIDTH);

/** 設定を当てた列 (並びを直し、隠した列を除く)。すべて隠そうとしても、先頭の 1 列は残す */
export function applyColumnPrefs<T extends { key: string }>(columns: readonly T[], prefs: ColumnPrefs): T[] {
  const rank = new Map(prefs.order.map((k, i) => [k, i]));
  const sorted = columns
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const ra = rank.get(a.c.key);
      const rb = rank.get(b.c.key);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.i - b.i;
    })
    .map((x) => x.c);
  const hidden = new Set(prefs.hidden);
  const shown = sorted.filter((c) => !hidden.has(c.key));
  return shown.length > 0 ? shown : sorted.slice(0, 1);
}

/** 並びを、いまの列の並び (keys) を基準に、key を 1 つ前 / 後ろへ */
export function moveColumn(keys: readonly string[], key: string, dir: -1 | 1): string[] {
  const at = keys.indexOf(key);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= keys.length) return [...keys];
  const next = [...keys];
  next.splice(at, 1);
  next.splice(to, 0, key);
  return next;
}

/** key を、target の位置へ (ヘッダのドラッグ) */
export function moveColumnTo(keys: readonly string[], key: string, target: string): string[] {
  const from = keys.indexOf(key);
  const to = keys.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...keys];
  const next = [...keys];
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}

/** 表示 / 非表示を切り替える。最後の 1 列は隠せない (all = いまの列すべての key) */
export function toggleHidden(prefs: ColumnPrefs, key: string, all: readonly string[]): ColumnPrefs {
  if (prefs.hidden.includes(key)) return { ...prefs, hidden: prefs.hidden.filter((k) => k !== key) };
  const visible = all.filter((k) => !prefs.hidden.includes(k));
  if (visible.length <= 1) return prefs;
  return { ...prefs, hidden: [...prefs.hidden, key] };
}

/** 幅を決める (null = 自動に戻す) */
export function setWidth(prefs: ColumnPrefs, key: string, px: number | null): ColumnPrefs {
  const widths = { ...prefs.widths };
  if (px === null) delete widths[key]; else widths[key] = clampWidth(px);
  return { ...prefs, widths };
}
