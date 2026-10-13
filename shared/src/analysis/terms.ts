/**
 * 用語の一貫性の検査。同じ物理名 (識別子) なのに表示名が違う、同じ表示名なのに物理名が違う、という揺れを見つけ、統一の候補を示す。
 * 対象はテーブルの列・テーブル・画面項目 (snake_case / camelCase は同じ名前として扱う)。
 */
import type { DesignDocInput, DocIssueRef } from "../designDocument.js";
import { normalizeIdentifier, normalizeTerm } from "./common.js";

export interface TermPlace { label: string; ref?: DocIssueRef }
export interface TermVariant { text: string; places: TermPlace[] }
export interface TermIssue {
  kind: "same-physical-different-display" | "same-display-different-physical";
  /** 揺れの見出し (物理名 / 表示名) */
  subject: string;
  variants: TermVariant[];
  /** 統一の候補 (いちばん多く使われている表記。同数なら先に出てきたもの) */
  suggestion: string;
}

/** どのテーブル・画面でも、意味が文脈で変わる汎用的な名前 (これの表示名の違いは揺れとは見なさない) */
const GENERIC_PHYSICAL = new Set(["id", "no", "name", "code", "status", "type", "kind", "note", "notes", "remarks", "memo", "flag", "description", "comment", "title", "value", "label", "count", "total", "date", "time", "createdat", "updatedat", "deletedat", "createdby", "updatedby", "version", "sort", "order", "seq", "index"]);

interface Entry { physical: string; display: string; place: TermPlace }

function collect(input: DesignDocInput): Entry[] {
  const out: Entry[] = [];
  for (const t of input.tables) {
    if (t.physicalName && t.name) out.push({ physical: t.physicalName, display: t.name, place: { label: `テーブル「${t.name}」`, ref: { kind: "table", id: t.id } } });
    for (const c of t.columns ?? []) if (c.physicalName && c.name) out.push({ physical: c.physicalName, display: c.name, place: { label: `テーブル「${t.name ?? t.id}」の列`, ref: { kind: "table", id: t.id } } });
  }
  for (const s of input.screens) for (const it of s.items ?? []) {
    if (it.id && it.label) out.push({ physical: it.id, display: it.label, place: { label: `画面「${s.name ?? s.id}」の項目`, ref: { kind: "screen", id: s.id } } });
  }
  return out;
}

const mostFrequent = (xs: Array<{ text: string; n: number }>): string => xs.reduce((best, x) => (x.n > best.n ? x : best), xs[0]).text;

export function findTermInconsistencies(input: DesignDocInput): TermIssue[] {
  const entries = collect(input);
  const out: TermIssue[] = [];

  // 1. 同じ物理名で、表示名が違う
  const byPhysical = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = normalizeIdentifier(e.physical);
    if (k.length < 3 || GENERIC_PHYSICAL.has(k)) continue;
    (byPhysical.get(k) ?? byPhysical.set(k, []).get(k)!).push(e);
  }
  for (const list of byPhysical.values()) {
    const variants = groupBy(list, (e) => normalizeTerm(e.display), (e) => e.display);
    if (variants.length < 2) continue;
    out.push({ kind: "same-physical-different-display", subject: list[0].physical, variants, suggestion: mostFrequent(variants.map((v) => ({ text: v.text, n: v.places.length }))) });
  }

  // 2. 同じ表示名で、物理名が違う
  const byDisplay = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = normalizeTerm(e.display);
    if (k.length < 2) continue;
    (byDisplay.get(k) ?? byDisplay.set(k, []).get(k)!).push(e);
  }
  for (const list of byDisplay.values()) {
    const variants = groupBy(list, (e) => normalizeIdentifier(e.physical), (e) => e.physical);
    if (variants.length < 2) continue;
    out.push({ kind: "same-display-different-physical", subject: list[0].display, variants, suggestion: mostFrequent(variants.map((v) => ({ text: v.text, n: v.places.length }))) });
  }
  return out;
}

/** 正規化した鍵ごとに束ね、見える表記 (最初に出てきたもの) と、その場所を返す */
function groupBy(list: Entry[], key: (e: Entry) => string, text: (e: Entry) => string): TermVariant[] {
  const m = new Map<string, TermVariant>();
  for (const e of list) {
    const k = key(e);
    const v = m.get(k) ?? m.set(k, { text: text(e), places: [] }).get(k)!;
    if (!v.places.some((p) => p.label === e.place.label && p.ref?.id === e.place.ref?.id)) v.places.push(e.place);
  }
  return [...m.values()];
}
