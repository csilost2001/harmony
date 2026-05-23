/**
 * @<kind-prefix>.<name> 補完 Resolver (#1303)。
 *
 * generic-definition の各 kind を catalog として補完候補化:
 *   - @dialog.<name>       → ctx.genericDefinitionsByKind["dialog"]
 *   - @messageArea.<name>  → ctx.genericDefinitionsByKind["messageArea"]
 *   - @options.<name>      → ctx.genericDefinitionsByKind["options"]
 *
 * spec 出典: docs/spec/generic-definition-layer.md §4.2
 */

import type { CompletionContext, CompletionState, Resolver } from "./types";

const KIND_PREFIXES = ["dialog", "messageArea", "options"] as const;

export const genericDefinitionResolver: Resolver = {
  id: "genericDefinition",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    if (!ctx.genericDefinitionsByKind) return null;

    const before = value.slice(0, cursorPos);

    for (const kind of KIND_PREFIXES) {
      const re = new RegExp(`@${kind}\\.([\\w-]*)$`);
      const m = before.match(re);
      if (m) {
        const prefix = m[1];
        const items = ctx.genericDefinitionsByKind[kind] ?? [];
        const candidates = items
          .filter((i) => i.name.startsWith(prefix))
          .map((i) => ({ value: i.name, label: i.name }));
        return {
          phase: "active",
          resolverId: "genericDefinition",
          prefix,
          candidates,
          replaceLen: prefix.length,
        };
      }
    }

    return null;
  },
};
