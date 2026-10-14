/**
 * スニペット (よく使う部品の並びの保存)。選んだカラム・画面項目・処理フローの工程を、名前をつけて残し、あとで挿入する。
 * ブラウザごとの保存 (localStorage、ワークスペースごと)。設計の原本には関係しない。
 * 他の人・他のブラウザへは、JSON ファイルの書き出し / 読み込みで渡す。
 */
import { useSyncExternalStore } from "react";

export type SnippetKind = "columns" | "screen-items" | "steps";
export const SNIPPET_KIND_LABELS: Record<SnippetKind, string> = { "columns": "カラム", "screen-items": "画面項目", "steps": "処理フローの工程" };
export const SNIPPET_UNIT: Record<SnippetKind, string> = { "columns": "列", "screen-items": "項目", "steps": "工程" };

export interface Snippet {
  id: string;
  kind: SnippetKind;
  name: string;
  /** 中身 (カラム・画面項目・工程の JSON)。挿入のとき複製して、ID は付け直す */
  items: Record<string, unknown>[];
  createdAt: string;
}

export const SNIPPETS_MAX = 100;
export const SNIPPET_ITEMS_MAX = 200;
export const SNIPPET_NAME_MAX = 60;
const PREFIX = "harmony-snippets:";
const KINDS: readonly SnippetKind[] = ["columns", "screen-items", "steps"];

const listeners = new Set<() => void>();
const cache = new Map<string, readonly Snippet[]>();
const keyOf = (wsId: string | undefined) => `${PREFIX}${wsId ?? "default"}`;
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** 1 件を検証して取り込む。形が違うものは null (保存値・読み込んだファイルの両方で使う) */
export function sanitizeSnippet(v: unknown): Snippet | null {
  if (!isRecord(v)) return null;
  const { kind, name, items } = v;
  if (typeof kind !== "string" || !KINDS.includes(kind as SnippetKind)) return null;
  if (typeof name !== "string" || name.trim() === "") return null;
  if (!Array.isArray(items) || items.length === 0 || items.length > SNIPPET_ITEMS_MAX || !items.every(isRecord)) return null;
  return {
    id: typeof v.id === "string" && v.id ? v.id : newId(),
    kind: kind as SnippetKind,
    name: name.trim().slice(0, SNIPPET_NAME_MAX),
    // 深い複製 (保存値・読み込んだファイルを、あとから書き換えない)
    items: JSON.parse(JSON.stringify(items)) as Record<string, unknown>[],
    createdAt: typeof v.createdAt === "string" ? v.createdAt : new Date().toISOString(),
  };
}

function newId(): string { return `sn-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

export function parseSnippets(raw: string | null): Snippet[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.map(sanitizeSnippet).filter((s): s is Snippet => !!s).slice(0, SNIPPETS_MAX);
  } catch { return []; }
}

export function loadSnippets(wsId: string | undefined): readonly Snippet[] {
  const k = keyOf(wsId);
  const hit = cache.get(k);
  if (hit) return hit;
  let raw: string | null = null;
  try { raw = localStorage.getItem(k); } catch { /* 読めなければ空 */ }
  const v = parseSnippets(raw);
  cache.set(k, v);
  return v;
}

function save(wsId: string | undefined, next: readonly Snippet[]): void {
  const k = keyOf(wsId);
  cache.set(k, next);
  try { if (next.length === 0) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(next)); } catch { /* 保存できなくても、この画面の中では効く */ }
  listeners.forEach((l) => l());
}

export type AddResult = { ok: true; snippet: Snippet } | { ok: false; reason: string };

/** 選んだ中身を、名前をつけて保存する。同じ種類で同じ名前があれば、上書きせず断る */
export function addSnippet(wsId: string | undefined, kind: SnippetKind, name: string, items: readonly unknown[]): AddResult {
  const all = loadSnippets(wsId);
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, reason: "名前を入れてください" };
  if (all.some((s) => s.kind === kind && s.name === trimmed.slice(0, SNIPPET_NAME_MAX))) return { ok: false, reason: "同じ名前のスニペットがあります" };
  if (all.length >= SNIPPETS_MAX) return { ok: false, reason: `スニペットは ${SNIPPETS_MAX} 件までです。使わないものを削除してください` };
  const snippet = sanitizeSnippet({ kind, name: trimmed, items });
  if (!snippet) return { ok: false, reason: items.length === 0 ? "保存する中身がありません" : `一度に保存できるのは ${SNIPPET_ITEMS_MAX} 件までです` };
  save(wsId, [snippet, ...all]);
  return { ok: true, snippet };
}

export function removeSnippet(wsId: string | undefined, id: string): void {
  const all = loadSnippets(wsId);
  if (all.some((s) => s.id === id)) save(wsId, all.filter((s) => s.id !== id));
}

/** 書き出し (ファイルの中身)。種類を指定すれば、その種類だけ */
export function exportSnippets(wsId: string | undefined, kind?: SnippetKind): string {
  const list = loadSnippets(wsId).filter((s) => !kind || s.kind === kind);
  return JSON.stringify({ format: "harmony-snippets", version: 1, snippets: list }, null, 2);
}

export interface ImportResult { added: number; skipped: number; error?: string }

/** 読み込み。形が違うものと、同じ種類・同じ名前のものは飛ばす (既存を上書きしない) */
export function importSnippets(wsId: string | undefined, text: string): ImportResult {
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { added: 0, skipped: 0, error: "JSON として読めません" }; }
  const list = isRecord(parsed) && parsed.format === "harmony-snippets" && Array.isArray(parsed.snippets) ? parsed.snippets : null;
  if (!list) return { added: 0, skipped: 0, error: "Harmony のスニペットのファイルではありません" };
  let all = [...loadSnippets(wsId)];
  let added = 0;
  let skipped = 0;
  for (const v of list) {
    const s = sanitizeSnippet(isRecord(v) ? { ...v, id: undefined } : v);
    if (!s || all.length >= SNIPPETS_MAX || all.some((x) => x.kind === s.kind && x.name === s.name)) { skipped++; continue; }
    all = [s, ...all];
    added++;
  }
  if (added > 0) save(wsId, all);
  return { added, skipped };
}

export function subscribeSnippets(l: () => void): () => void {
  listeners.add(l);
  const onStorage = (e: StorageEvent) => { if (e.key?.startsWith(PREFIX)) { cache.delete(e.key); l(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(l); window.removeEventListener("storage", onStorage); };
}

export function useSnippets(wsId: string | undefined): readonly Snippet[] {
  return useSyncExternalStore(subscribeSnippets, () => loadSnippets(wsId), () => loadSnippets(wsId));
}

/** テスト用 */
export function _resetSnippetsCache(): void { cache.clear(); }
