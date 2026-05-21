/**
 * @conv.* 補完フック (後方互換 wrapper)。
 *
 * 内部実装を utils/reference-completer/completer + convResolver に委譲しつつ、
 * 旧来の CompletionState 型 (category / key / idle) と computeCompletion /
 * insertCandidate 関数シグネチャを維持する。
 *
 * callsite 7 箇所 (ConvCompletionInput.tsx / AuditStepPanel.tsx 等) はこのまま使い続けられる。
 */

import type { ConventionsCatalog } from "../schemas/conventionsValidator";
import { computeReferenceCompletion, insertReferenceCandidate } from "../utils/reference-completer/completer";
import { convResolver } from "../utils/reference-completer/convResolver";

export const ALL_CONV_CATEGORIES = [
  "msg", "regex", "limit", "scope", "currency", "tax", "auth",
  "db", "numbering", "tx", "externalOutcomeDefaults",
] as const;

/** 旧来の CompletionState 型 (callsite 互換のため維持)。 */
export type CompletionState =
  | { phase: "idle" }
  | { phase: "category"; prefix: string; candidates: string[] }
  | { phase: "key"; category: string; prefix: string; candidates: string[] };

/**
 * カーソル直前の @conv.* パターンから補完状態を計算する純粋関数。
 * catalog が null なら常に idle を返す。
 * 内部では統合 reference completer に委譲する。
 */
export function computeCompletion(
  value: string,
  cursorPos: number,
  catalog: ConventionsCatalog | null,
): CompletionState {
  if (!catalog) return { phase: "idle" };

  const s = computeReferenceCompletion(value, cursorPos, [convResolver], { conventions: catalog });
  if (s.phase !== "active") return { phase: "idle" };

  // 旧来の category / key phase 判別: before に regex で再マッチ
  const before = value.slice(0, cursorPos);
  const m = before.match(/@conv(?:\.([\w-]*)(?:\.([\w-]*))?)?$/);
  if (!m) return { phase: "idle" };

  const catPart = m[1];
  const keyPart = m[2];

  if (keyPart === undefined) {
    return {
      phase: "category",
      prefix: catPart ?? "",
      candidates: s.candidates.map((c) => c.value),
    };
  }
  return {
    phase: "key",
    category: catPart!,
    prefix: keyPart,
    candidates: s.candidates.map((c) => c.value),
  };
}

/**
 * 補完候補を確定してテキストに挿入する純粋関数。
 * category phase では末尾に "." を付与し、key phase では置換のみ。
 * 内部では統合 reference completer に委譲する。
 */
export function insertCandidate(
  value: string,
  cursorPos: number,
  state: CompletionState,
  picked: string,
): { newValue: string; newCursor: number } {
  if (state.phase === "idle") return { newValue: value, newCursor: cursorPos };
  const trailing = state.phase === "category" ? "." : "";
  const newState = computeReferenceCompletion(value, cursorPos, [convResolver], {});
  // newState が idle の場合は直接計算にフォールバック (backward compat)
  if (newState.phase !== "active") {
    const before = value.slice(0, cursorPos);
    const after = value.slice(cursorPos);
    const newBefore = before.slice(0, before.length - state.prefix.length) + picked + trailing;
    return { newValue: newBefore + after, newCursor: newBefore.length };
  }
  return insertReferenceCandidate(value, cursorPos, newState, { value: picked, trailing: trailing || undefined });
}
