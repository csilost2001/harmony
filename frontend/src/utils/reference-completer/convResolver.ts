/**
 * @conv.<category>.<key> 補完 Resolver (Phase 1 / #1255)
 *
 * 既存 useConvCompletion.ts の computeCompletion ロジックを
 * Resolver 形式に移植したもの。
 * ALL_CONV_CATEGORIES は useConvCompletion.ts で定義されたものを参照。
 */

import { ALL_CONV_CATEGORIES } from "../../hooks/useConvCompletion";
import type { Candidate, CompletionContext, CompletionState, Resolver } from "./types";
import { looseMatch } from "../textMatch";

/** 規約の値を 1 行の短い文字にする (候補の説明用)。 */
export function summarizeValue(v: unknown, max = 80): string {
  let text: string;
  try {
    text = typeof v === "string" ? v : JSON.stringify(v) ?? String(v);
  } catch {
    text = String(v);
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export const convResolver: Resolver = {
  id: "conv",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    if (!ctx.conventions) return null;

    const before = value.slice(0, cursorPos);
    // @conv 以降にカテゴリ部・キー部が続くパターンにマッチ
    const m = before.match(/@conv(?:\.([\w-]*)(?:\.([\w-]*))?)?$/);
    if (!m) return null;

    const catPart = m[1];
    const keyPart = m[2];

    if (keyPart === undefined) {
      // カテゴリ補完フェーズ
      const prefix = catPart ?? "";
      const candidates: Candidate[] = (ALL_CONV_CATEGORIES as readonly string[])
        .filter((c) => looseMatch(c, prefix))
        .map((c) => ({ value: c, label: c, trailing: "." }));
      return {
        phase: "active",
        resolverId: "conv",
        prefix,
        candidates,
        replaceLen: prefix.length,
      };
    }

    // キー補完フェーズ
    const cat = (ctx.conventions as unknown as Record<string, unknown>)[catPart!];
    if (!cat || typeof cat !== "object") return null;
    const keys = Object.keys(cat as object).filter((k) => looseMatch(k, keyPart));
    const candidates: Candidate[] = keys.map((k) => ({
      value: k,
      detail: `現在の値: ${summarizeValue((cat as Record<string, unknown>)[k])}`,
    }));
    return {
      phase: "active",
      resolverId: "conv",
      prefix: keyPart,
      candidates,
      replaceLen: keyPart.length,
    };
  },
};
