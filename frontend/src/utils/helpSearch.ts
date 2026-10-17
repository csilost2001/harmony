/**
 * ヘルプの全文検索と、いまの画面に関係する項目 (UI 改善提案 続編 第 10 弾 #189)。画面に依存しない純関数。
 * 探す対象: 項目ごとのヘルプ (helpTopics) と、ショートカット一覧 (shortcuts)。全角半角・大文字小文字・ひらがな / カタカナの違いは無視する。
 * いまの画面に関係する項目は、同じ得点なら先に出す。
 */
import { HELP_TOPICS, type HelpTopic } from "./helpTopics";
import { SHORTCUT_GROUPS, relevantGroupTitles } from "./shortcuts";
import { normalizeForMatch } from "./textMatch";

export type HelpHit =
  | { kind: "topic"; id: string; title: string; snippet: string; doc?: string; here: boolean; score: number }
  | { kind: "shortcut"; keys: string[]; label: string; group: string; here: boolean; score: number };

/** 項目のヘルプの id の接頭辞 → 関係する画面の経路 (workspace の接頭辞を除いたもの) */
const TOPIC_AREAS: Array<[prefix: string, route: RegExp]> = [
  ["table.", /^\/table\//],
  ["layout.", /^\/screen\/design\//],
  ["analysis.", /^\/analysis/],
];

/** 項目のヘルプが、この画面に関係するか */
export function topicRelevant(topicId: string, pathname: string): boolean {
  const rest = pathname.replace(/^\/w\/[^/]+/, "") || "/";
  const area = TOPIC_AREAS.find(([p]) => topicId.startsWith(p));
  return !!area && area[1].test(rest);
}

const norm = (s: string) => normalizeForMatch(s);

function topicText(t: HelpTopic): { title: string; body: string } { return { title: norm(t.title), body: norm(t.body.join(" ")) }; }

/** 検索語 (空白区切りは、すべてを含む) に当たるものを、得点順に。得点: 題名に含む 10・ショートカットの説明に含む 6・本文に含む 3。この画面に関係するものは +1 */
export function searchHelp(query: string, pathname: string, limit = 30): HelpHit[] {
  const words = norm(query.trim()).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const all = (text: string) => words.every((w) => text.includes(w));
  const hits: HelpHit[] = [];
  for (const [id, t] of Object.entries(HELP_TOPICS)) {
    const n = topicText(t);
    const inTitle = all(n.title);
    const inAny = all(`${n.title} ${n.body}`);
    if (!inAny) continue;
    const here = topicRelevant(id, pathname);
    hits.push({ kind: "topic", id, title: t.title, snippet: t.body[0] ?? "", ...(t.doc ? { doc: t.doc } : {}), here, score: (inTitle ? 10 : 3) + (here ? 1 : 0) });
  }
  const relevant = relevantGroupTitles(pathname);
  for (const g of SHORTCUT_GROUPS) {
    for (const e of g.entries) {
      const text = norm(`${e.label} ${e.keys.join(" ")}`);
      if (!all(text)) continue;
      const here = relevant.includes(g.title);
      hits.push({ kind: "shortcut", keys: e.keys, label: e.label, group: g.title, here, score: 6 + (here ? 1 : 0) });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** いまの画面に関係する、項目ごとのヘルプ (一覧の先頭に出す用) */
export function relevantTopics(pathname: string): Array<{ id: string; topic: HelpTopic }> {
  return Object.entries(HELP_TOPICS).filter(([id]) => topicRelevant(id, pathname)).map(([id, topic]) => ({ id, topic }));
}
