import type { ConventionsCatalog } from "../schemas/conventionsValidator";

export const ALL_CONV_CATEGORIES = [
  "msg", "regex", "limit", "scope", "currency", "tax", "auth",
  "db", "numbering", "tx", "externalOutcomeDefaults",
] as const;

export type CompletionState =
  | { phase: "idle" }
  | { phase: "category"; prefix: string; candidates: string[] }
  | { phase: "key"; category: string; prefix: string; candidates: string[] };

/**
 * カーソル直前の @conv.* パターンから補完状態を計算する純粋関数。
 * catalog が null なら常に idle を返す。
 */
export function computeCompletion(
  value: string,
  cursorPos: number,
  catalog: ConventionsCatalog | null,
): CompletionState {
  if (!catalog) return { phase: "idle" };
  const before = value.slice(0, cursorPos);
  const m = before.match(/@conv(?:\.([\w-]*)(?:\.([\w-]*))?)?$/);
  if (!m) return { phase: "idle" };

  const catPart = m[1];
  const keyPart = m[2];

  if (keyPart === undefined) {
    const prefix = catPart ?? "";
    const candidates = ALL_CONV_CATEGORIES.filter((c) => c.startsWith(prefix));
    return { phase: "category", prefix, candidates: [...candidates] };
  } else {
    const cat = (catalog as unknown as Record<string, unknown>)[catPart!];
    if (!cat || typeof cat !== "object") return { phase: "idle" };
    const keys = Object.keys(cat);
    const candidates = keys.filter((k) => k.startsWith(keyPart));
    return { phase: "key", category: catPart!, prefix: keyPart, candidates };
  }
}

/**
 * 補完候補を確定してテキストに挿入する純粋関数。
 * category phase では末尾に "." を付与し、key phase では置換のみ。
 */
export function insertCandidate(
  value: string,
  cursorPos: number,
  state: CompletionState,
  picked: string,
): { newValue: string; newCursor: number } {
  if (state.phase === "idle") return { newValue: value, newCursor: cursorPos };
  const before = value.slice(0, cursorPos);
  const after = value.slice(cursorPos);
  const prefixLen = state.prefix.length;
  const trailing = state.phase === "category" ? "." : "";
  const newBefore = before.slice(0, before.length - prefixLen) + picked + trailing;
  return { newValue: newBefore + after, newCursor: newBefore.length };
}
