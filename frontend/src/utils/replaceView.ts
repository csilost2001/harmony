/**
 * 設計全体の検索置換の画面の、表示用の計算 (純関数)。
 */
export type ReplaceKind =
  | "screen" | "table" | "process-flow" | "business-flow" | "report" | "sequence" | "view" | "view-definition" | "page-layout" | "generic-definition";

export interface ReplaceCandidate { key: string; kind: ReplaceKind; id: string; entityName: string; where: string; before: string; after: string }
export interface ReplacePreview {
  candidates: ReplaceCandidate[];
  total: number;
  truncated: boolean;
  entities: number;
  blocked: Array<{ kind: ReplaceKind; id: string; reason: string }>;
}
export interface ReplaceResult {
  operationId: string | null;
  replaced: number;
  files: number;
  skipped: Array<{ key: string; reason: string }>;
  touched: Array<{ kind: ReplaceKind; id: string }>;
}

export const REPLACE_KIND_LABELS: Record<ReplaceKind, string> = {
  "screen": "画面", "table": "テーブル", "process-flow": "処理フロー", "business-flow": "業務フロー", "report": "帳票", "sequence": "シーケンス",
  "view": "ビュー", "view-definition": "ビュー定義", "page-layout": "ページレイアウト", "generic-definition": "汎用定義",
};
export const REPLACE_KIND_ICONS: Record<ReplaceKind, string> = {
  "screen": "bi-window", "table": "bi-table", "process-flow": "bi-lightning", "business-flow": "bi-diagram-2", "report": "bi-file-earmark-text",
  "sequence": "bi-arrow-repeat", "view": "bi-eye", "view-definition": "bi-layout-text-window", "page-layout": "bi-layout-wtf", "generic-definition": "bi-collection",
};

export interface Segment { text: string; hit: boolean }

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 文字列を、探す語に合う部分と、そうでない部分に分ける (置換前の文言の強調に使う) */
export function splitByQuery(text: string, query: string, caseSensitive: boolean): Segment[] {
  if (!query) return [{ text, hit: false }];
  const re = new RegExp(escapeRegExp(query), caseSensitive ? "g" : "gi");
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), hit: false });
    out.push({ text: m[0], hit: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length > 0 ? out : [{ text, hit: false }];
}

/**
 * 置換後の文言の強調。置換前と同じ並びで分ける: 探す語に合った部分が、置き換える語になっている。
 * (置き換える語が空なら、強調する部分はなく、消えた分は強調しない)
 */
export function afterSegments(before: string, query: string, replacement: string, caseSensitive: boolean): Segment[] {
  return splitByQuery(before, query, caseSensitive).map((s) => (s.hit ? { text: replacement, hit: true } : s)).filter((s) => s.text !== "");
}

export interface EntityGroup {
  kind: ReplaceKind;
  id: string;
  entityName: string;
  items: ReplaceCandidate[];
  blocked: string | null;
}

/** 設計ごとにまとめる (種類 → ID の順、並びは安定)。編集中の設計は blocked に理由が入る */
export function groupByEntity(candidates: readonly ReplaceCandidate[], blocked: ReplacePreview["blocked"]): EntityGroup[] {
  const reason = new Map(blocked.map((b) => [`${b.kind}:${b.id}`, b.reason]));
  const groups = new Map<string, EntityGroup>();
  for (const c of candidates) {
    const k = `${c.kind}:${c.id}`;
    let g = groups.get(k);
    if (!g) { g = { kind: c.kind, id: c.id, entityName: c.entityName, items: [], blocked: reason.get(k) ?? null }; groups.set(k, g); }
    g.items.push(c);
  }
  return [...groups.values()];
}

/** 置換できる (編集中でない) 候補の key */
export function replaceableKeys(groups: readonly EntityGroup[]): string[] {
  return groups.filter((g) => !g.blocked).flatMap((g) => g.items.map((c) => c.key));
}
