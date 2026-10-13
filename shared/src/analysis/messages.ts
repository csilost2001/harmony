/**
 * メッセージ・文言の管理。メッセージごとの使用箇所、未使用、定義の無いメッセージの参照、似ている (重複した) 文面を一覧にする。
 */
import type { DesignDocInput } from "../designDocument.js";
import { convRefs, jsonText, normalizeTerm } from "./common.js";
import { buildDesignGraph, type DesignGraph, type NodeKind } from "./graph.js";

export interface MessageUse { kind: NodeKind; id: string; name: string }
export interface MessageUsage { key: string; template: string; description?: string; uses: MessageUse[] }
export interface SimilarMessages { keys: string[]; reason: "same" | "similar"; score: number }
export interface MessageAnalysis {
  messages: MessageUsage[];
  unused: MessageUsage[];
  /** 使われているが、規約カタログに定義の無いメッセージ */
  undefinedRefs: Array<{ key: string; uses: MessageUse[] }>;
  similar: SimilarMessages[];
}

/** 文面の比較用: 差し込み {x} を {} にそろえ、記号・空白を除く */
function comparable(template: string): string {
  return normalizeTerm(template.replace(/\{[^}]*\}/g, "{}")).replace(/[、。,.!?！？「」『』()（）]/g, "");
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) ?? 0) + 1); }
  return m;
}
function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

export const SIMILARITY_THRESHOLD = 0.85;

export function analyzeMessages(input: DesignDocInput, graph: DesignGraph = buildDesignGraph(input)): MessageAnalysis {
  const defs = Object.entries(input.messages ?? {});
  const usesOf = (key: string): MessageUse[] => (graph.dependents.get(`message:${key}`) ?? []).flatMap((e) => { const n = graph.nodes.get(e.from); return n ? [{ kind: n.kind, id: n.id, name: n.name }] : []; });
  const messages: MessageUsage[] = defs.map(([key, m]) => ({ key, template: m.template ?? "", ...(m.description ? { description: m.description } : {}), uses: usesOf(key) }));

  // 定義の無い参照: 設計の本文の中の `@conv.msg.*` で、カタログに無いもの
  const defined = new Set(defs.map(([k]) => k));
  const undef = new Map<string, MessageUse[]>();
  const scan = (kind: NodeKind, id: string, name: string, value: unknown) => {
    for (const k of convRefs(jsonText(value), "msg")) if (!defined.has(k)) (undef.get(k) ?? undef.set(k, []).get(k)!).push({ kind, id, name });
  };
  for (const s of input.screens) scan("screen", s.id, s.name ?? s.id, s);
  for (const f of input.flows) scan("processFlow", f.meta.id, f.meta.name ?? f.meta.id, f);
  for (const b of input.businessFlows ?? []) scan("businessFlow", b.id, b.name, b);
  for (const r of input.reports ?? []) scan("report", r.id, r.name, r);
  for (const g of input.genericDefinitions ?? []) scan("genericDefinition", `${g.kind}/${g.name}`, g.name, g);

  // 似ている文面 (同じ文面は 1 まとまり。そうでなければ 2 つずつ、似ている度合いで)
  const similar: SimilarMessages[] = [];
  const comp = messages.filter((m) => m.template).map((m) => ({ key: m.key, c: comparable(m.template) })).filter((x) => x.c.length >= 4);
  const byText = new Map<string, string[]>();
  for (const x of comp) (byText.get(x.c) ?? byText.set(x.c, []).get(x.c)!).push(x.key);
  const grouped = new Set<string>();
  for (const keys of byText.values()) if (keys.length > 1) { similar.push({ keys, reason: "same", score: 1 }); keys.forEach((k) => grouped.add(k)); }
  const distinct = [...byText.entries()].map(([c, keys]) => ({ c, key: keys[0] }));
  for (let i = 0; i < distinct.length; i++) for (let j = i + 1; j < distinct.length; j++) {
    if (Math.abs(distinct[i].c.length - distinct[j].c.length) > Math.max(distinct[i].c.length, distinct[j].c.length) * 0.4) continue;
    const score = dice(distinct[i].c, distinct[j].c);
    if (score >= SIMILARITY_THRESHOLD) similar.push({ keys: [distinct[i].key, distinct[j].key], reason: "similar", score: Math.round(score * 100) / 100 });
  }
  return { messages, unused: messages.filter((m) => m.uses.length === 0), undefinedRefs: [...undef.entries()].map(([key, uses]) => ({ key, uses })), similar };
}
