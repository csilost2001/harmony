/**
 * @secret.<key> 補完 Resolver (#1282)。
 *
 * ctx.workspace.secrets の id 一覧を候補として返す。
 * spec 出典: process-flow-expression-language.md §context.catalogs.secrets
 */

import type { CompletionContext, CompletionState, Resolver } from "./types";

export const secretPrefixResolver: Resolver = {
  id: "secret",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    if (!ctx.workspace) return null;

    const before = value.slice(0, cursorPos);
    const m = before.match(/@secret\.([\w-]*)$/);
    if (!m) return null;

    const prefix = m[1];
    const candidates = (ctx.workspace.secrets ?? [])
      .filter((s) => s.id.startsWith(prefix))
      .map((s) => ({ value: s.id, label: s.id, hint: s.name }));

    return {
      phase: "active",
      resolverId: "secret",
      prefix,
      candidates,
      replaceLen: prefix.length,
    };
  },
};
