/**
 * クイックオープン (Ctrl+K) の検索。画面・テーブル・処理フローなどを ID・名前・物理名・URL から
 * 1 つの検索ボックスで探して開くための、候補の組み立てと並べ替え (画面に依存しない純関数)。
 */

export type QuickOpenKind =
  | "screen" | "screen-items" | "table" | "process-flow" | "business-flow" | "report"
  | "sequence" | "view" | "view-definition" | "page";

export const QUICK_OPEN_KIND_LABELS: Record<QuickOpenKind, string> = {
  "screen": "画面",
  "screen-items": "画面項目",
  "table": "テーブル",
  "process-flow": "処理フロー",
  "business-flow": "業務フロー",
  "report": "帳票",
  "sequence": "シーケンス",
  "view": "ビュー",
  "view-definition": "ビュー定義",
  "page": "ページ",
};

export const QUICK_OPEN_KIND_ICONS: Record<QuickOpenKind, string> = {
  "screen": "bi-window",
  "screen-items": "bi-ui-checks",
  "table": "bi-table",
  "process-flow": "bi-lightning",
  "business-flow": "bi-diagram-2",
  "report": "bi-file-earmark-text",
  "sequence": "bi-arrow-repeat",
  "view": "bi-eye",
  "view-definition": "bi-layout-text-window",
  "page": "bi-compass",
};

export interface QuickOpenEntry {
  /** 一意キー (kind:id) */
  key: string;
  kind: QuickOpenKind;
  id: string;
  /** 主な表示名 */
  label: string;
  /** 補足 (ID や物理名など。検索の対象にもなる) */
  hints: string[];
  /** ワークスペース配下の route (`/screen/design/x`) */
  route: string;
  /** 同点のときの並び (小さいほど先) */
  order: number;
}

export interface QuickOpenSources {
  screens?: { id: string; name: string; path?: string }[];
  tables?: { id: string; name: string; physicalName?: string }[];
  processFlows?: { id: string; name: string }[];
  businessFlows?: { id: string; name: string }[];
  reports?: { id: string; name: string }[];
  sequences?: { id: string; name: string; physicalName?: string }[];
  views?: { id: string; name: string; physicalName?: string }[];
  viewDefinitions?: { id: string; name: string }[];
  pages?: { id: string; label: string; route: string }[];
}

/** 比較用に正規化する (全角半角・大文字小文字・ひらがな/カタカナの差を無視) */
export function normalizeQuery(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

export function buildQuickOpenEntries(src: QuickOpenSources): QuickOpenEntry[] {
  const out: QuickOpenEntry[] = [];
  let order = 0;
  const add = (kind: QuickOpenKind, id: string, label: string, hints: (string | undefined)[], route: string) => {
    out.push({ key: `${kind}:${id}`, kind, id, label: label || id, hints: [id, ...hints].filter((h): h is string => !!h), route, order: order++ });
  };
  const enc = encodeURIComponent;
  for (const s of src.screens ?? []) {
    add("screen", s.id, s.name, [s.path], `/screen/design/${enc(s.id)}`);
  }
  for (const t of src.tables ?? []) add("table", t.id, t.name, [t.physicalName], `/table/edit/${enc(t.id)}`);
  for (const f of src.processFlows ?? []) add("process-flow", f.id, f.name, [], `/process-flow/edit/${enc(f.id)}`);
  for (const f of src.businessFlows ?? []) add("business-flow", f.id, f.name, [], `/business-flow/edit/${enc(f.id)}`);
  for (const r of src.reports ?? []) add("report", r.id, r.name, [], `/report/edit/${enc(r.id)}`);
  for (const s of src.sequences ?? []) add("sequence", s.id, s.name, [s.physicalName], `/sequence/edit/${enc(s.id)}`);
  for (const v of src.views ?? []) add("view", v.id, v.name, [v.physicalName], `/view/edit/${enc(v.id)}`);
  for (const v of src.viewDefinitions ?? []) add("view-definition", v.id, v.name, [], `/view-definition/edit/${enc(v.id)}`);
  // 画面項目は画面と対になるが、検索語がないときの一覧が画面で埋まらないよう後ろにまとめる
  for (const s of src.screens ?? []) add("screen-items", s.id, `${s.name} (項目定義)`, [s.name], `/screen/items/${enc(s.id)}`);
  for (const p of src.pages ?? []) add("page", p.id, p.label, [], p.route);
  return out;
}

/** 1 語が 1 つの文字列にどれだけ合うか。0 = 合わない。大きいほどよく合う */
function scoreToken(token: string, text: string): number {
  if (!text) return 0;
  if (text === token) return 100;
  if (text.startsWith(token)) return 80;
  const at = text.indexOf(token);
  if (at >= 0) {
    // 単語の境界 (- _ . / 空白の直後) から始まるものを優先
    return /[-_./\s]/.test(text[at - 1] ?? "") ? 60 : 40;
  }
  return 0;
}

/** 文字が順番に含まれていれば合う (例: "ordcnf" → "order-confirm")。弱い一致 */
function isSubsequence(token: string, text: string): boolean {
  let i = 0;
  for (const ch of text) if (ch === token[i] && ++i === token.length) return true;
  return token.length === 0;
}

export interface QuickOpenHit { entry: QuickOpenEntry; score: number }

/**
 * 候補を検索語で絞り、よく合う順に返す。空白で区切った語はすべて合う必要がある (AND)。
 * 検索語が空なら、最近開いたもの (`recent` = 新しい順の key) を先頭に、残りを並び順で limit 件返す。
 */
export function searchQuickOpen(entries: QuickOpenEntry[], query: string, limit = 50, recent: readonly string[] = []): QuickOpenHit[] {
  const tokens = normalizeQuery(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    const byKey = new Map(entries.map((e) => [e.key, e]));
    const head = recent.map((k) => byKey.get(k)).filter((e): e is QuickOpenEntry => !!e);
    const seen = new Set(head.map((e) => e.key));
    return [...head, ...entries.filter((e) => !seen.has(e.key))].slice(0, limit).map((entry) => ({ entry, score: 0 }));
  }
  const hits: QuickOpenHit[] = [];
  for (const entry of entries) {
    const label = normalizeQuery(entry.label);
    const hints = entry.hints.map(normalizeQuery);
    const kindLabel = normalizeQuery(QUICK_OPEN_KIND_LABELS[entry.kind]);
    let total = 0;
    let ok = true;
    for (const token of tokens) {
      // 名前に合えば重み大、ID 等の補足は少し低く、種類名 ("テーブル" など) は絞り込みとして使う
      let best = Math.max(scoreToken(token, label) * 1.1, ...hints.map((h) => scoreToken(token, h)));
      if (best === 0) best = scoreToken(token, kindLabel) * 0.3;
      if (best === 0 && token.length >= 3 && hints.some((h) => isSubsequence(token, h))) best = 10;
      if (best === 0) { ok = false; break; }
      total += best;
    }
    if (ok) hits.push({ entry, score: total });
  }
  hits.sort((a, b) => b.score - a.score || a.entry.order - b.entry.order);
  return hits.slice(0, limit);
}

const RECENT_KEY = "harmony-quick-open-recent";
const RECENT_MAX = 10;

/** 最近開いたものの key (新しい順)。保存先が使えなくても動く */
export function loadRecentQuickOpen(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === "string").slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

export function rememberQuickOpen(key: string): void {
  try {
    const next = [key, ...loadRecentQuickOpen().filter((k) => k !== key)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* 保存できなくても開く動作は妨げない */ }
}
