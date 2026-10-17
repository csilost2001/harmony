/**
 * 利用者の設定の書き出し・読み込み (UI 改善提案 続編 第 10 弾 #191)。表示の設定・通知の受け取り方・お気に入り・スニペット・一覧の設定・メモなど、
 * このブラウザにだけ保存している設定を、1 つのファイルにして、別のブラウザ・別の人へ持ち出す。画面に依存しない部分 (Storage を渡す)。
 * 持ち出さないもの: 接続トークン・開いているタブ・スクロール位置・下書き・見た版の記録 (別のブラウザでは意味がない、または秘密)。
 * 読み込みは、台帳 (許可する名前) に当てはまる項目だけ。値は文字列で 500 KB まで。
 */
export interface SettingsCategory { id: string; label: string; note?: string; match: (key: string) => boolean }

const starts = (...prefixes: string[]) => (k: string) => prefixes.some((p) => k.startsWith(p));
const exact = (...names: string[]) => (k: string) => names.includes(k);

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: "display", label: "表示の設定 (文字サイズ・密度・コントラスト・動き・配色)", match: exact("harmony.display", "harmony.motion", "harmony.appTheme") },
  { id: "notify", label: "通知の受け取り方", match: exact("harmony.notify") },
  { id: "user", label: "利用者名 (自己申告)", match: exact("harmony.userName") },
  { id: "shortcuts", label: "ショートカットの割り当て", match: exact("harmony.shortcuts") },
  { id: "favorites", label: "お気に入り", note: "ワークスペースの ID が同じものにだけ効きます", match: starts("harmony-favorites:") },
  { id: "snippets", label: "スニペット", match: (k) => k === "harmony-snippets" || k.startsWith("harmony-snippets:") },
  { id: "lists", label: "一覧の設定 (列・保存した絞り込み・グループ・図の見え方)", note: "ワークスペースの ID が同じものにだけ効きます", match: starts("harmony.listColumns.", "harmony-list-views:", "harmony-list-group:", "harmony-diagram-view:", "harmony.columns.gridMode", "harmony.processFlow.view") },
  { id: "notes", label: "個人メモ・試作", note: "大きくなることがあります。ワークスペースの ID が同じものにだけ効きます", match: starts("harmony-personal-notes:", "harmony-trials:") },
];

export const MAX_VALUE_CHARS = 500_000;
export const SETTINGS_FORMAT = "harmony-settings";

export interface SettingsFile { format: typeof SETTINGS_FORMAT; version: 1; exportedAt: string; items: Record<string, string> }

export function categoryOf(key: string): SettingsCategory | null { return SETTINGS_CATEGORIES.find((c) => c.match(key)) ?? null; }

/** Storage の全項目のうち、台帳に当てはまるものを集める */
export function exportSettings(storage: Pick<Storage, "length" | "key" | "getItem">, now: Date = new Date()): SettingsFile {
  const items: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k || !categoryOf(k)) continue;
    const v = storage.getItem(k);
    if (v !== null && v.length <= MAX_VALUE_CHARS) items[k] = v;
  }
  return { format: SETTINGS_FORMAT, version: 1, exportedAt: now.toISOString(), items };
}

export interface ImportPreview {
  file: SettingsFile;
  /** 種類ごとの項目の数 (読み込めるものだけ) */
  counts: Array<{ category: SettingsCategory; keys: string[] }>;
  /** 読み込まない項目 (台帳に無い・値が大きすぎる・文字列でない) の数 */
  skipped: number;
}

export type ParseResult = { ok: true; preview: ImportPreview } | { ok: false; error: string };

export function parseSettingsFile(text: string): ParseResult {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, error: "JSON として読めません" }; }
  if (!raw || typeof raw !== "object") return { ok: false, error: "設定のファイルの形ではありません" };
  const o = raw as Record<string, unknown>;
  if (o.format !== SETTINGS_FORMAT) return { ok: false, error: "Harmony の設定のファイルではありません" };
  if (o.version !== 1) return { ok: false, error: `この版 (${String(o.version)}) の設定ファイルは読めません` };
  if (!o.items || typeof o.items !== "object" || Array.isArray(o.items)) return { ok: false, error: "設定のファイルに items がありません" };
  const items: Record<string, string> = {};
  let skipped = 0;
  for (const [k, v] of Object.entries(o.items as Record<string, unknown>)) {
    if (typeof v === "string" && v.length <= MAX_VALUE_CHARS && categoryOf(k)) items[k] = v; else skipped++;
  }
  const counts = SETTINGS_CATEGORIES.map((category) => ({ category, keys: Object.keys(items).filter((k) => category.match(k)) })).filter((c) => c.keys.length > 0);
  return { ok: true, preview: { file: { format: SETTINGS_FORMAT, version: 1, exportedAt: typeof o.exportedAt === "string" ? o.exportedAt : "", items }, counts, skipped } };
}

/** 選んだ種類の項目を書き込む。書き込めた数と、書けなかった数 (保存領域の不足など) を返す */
export function applySettings(storage: Pick<Storage, "setItem">, preview: ImportPreview, categoryIds: ReadonlySet<string>): { written: number; failed: number } {
  let written = 0;
  let failed = 0;
  for (const c of preview.counts) {
    if (!categoryIds.has(c.category.id)) continue;
    for (const k of c.keys) {
      try { storage.setItem(k, preview.file.items[k]); written++; } catch { failed++; }
    }
  }
  return { written, failed };
}
