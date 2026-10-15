/**
 * reference-completer 統合 API (Phase 1 / #1255)
 *
 * computeReferenceCompletion / insertReferenceCandidate を公開する。
 * Resolver 一覧を受け取り、最初にマッチした Resolver の CompletionState を返す。
 */

import { bestRank } from "../textMatch";
import type { Candidate, CompletionContext, CompletionState, Resolver } from "./types";

/**
 * resolver 一覧を先頭から試し、最初にマッチした CompletionState を返す。
 * どれもマッチしなければ { phase: "idle" } を返す。
 */
export function computeReferenceCompletion(
  value: string,
  cursorPos: number,
  resolvers: Resolver[],
  ctx: CompletionContext,
): CompletionState {
  for (const r of resolvers) {
    const s = r.match(value, cursorPos, ctx);
    if (s && s.phase === "active") return withPrefixFirst(s);
  }
  return { phase: "idle" };
}

/**
 * 補完候補を確定してテキストに挿入する純粋関数。
 * state が idle なら何もしない。
 */
export function insertReferenceCandidate(
  value: string,
  cursorPos: number,
  state: CompletionState,
  picked: Candidate,
): { newValue: string; newCursor: number } {
  if (state.phase === "idle") return { newValue: value, newCursor: cursorPos };
  const before = value.slice(0, cursorPos);
  const after = value.slice(cursorPos);
  const inserted = picked.value + (picked.trailing ?? "");
  const newBefore = before.slice(0, before.length - state.replaceLen) + inserted;
  return { newValue: newBefore + after, newCursor: newBefore.length };
}

/** 候補を「前方一致 → 部分一致」の順に並べる (補完ごとの絞り方の違いを、並びで揃える)。同順位は元の順。 */
function withPrefixFirst(state: Extract<CompletionState, { phase: "active" }>): CompletionState {
  if (state.prefix === "" || state.candidates.length < 2) return state;
  const ranked = state.candidates
    .map((c, i) => ({ c, i, r: bestRank([c.value, c.label], state.prefix) }))
    .sort((a, b) => (a.r === -1 ? 1 : a.r) - (b.r === -1 ? 1 : b.r) || a.i - b.i)
    .map((x) => x.c);
  return { ...state, candidates: ranked };
}
