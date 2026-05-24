/**
 * @<prefix>.<name> 補完 Resolver (#1303、#1318 で kind=kebab / prefix=camelCase 分離)。
 *
 * generic-definition の各 kind を catalog として補完候補化。`KIND_PREFIXES` は **prefix-keyed**
 * (regex 対象 + ctx dict key 両方):
 *   - @dialog.<name>       → ctx.genericDefinitionsByKind["dialog"]      (kind: "dialog")
 *   - @messageArea.<name>  → ctx.genericDefinitionsByKind["messageArea"] (kind: "message-area" #1318)
 *   - @options.<name>      → ctx.genericDefinitionsByKind["options"]     (kind: "options")
 *
 * messageArea / message-area は kind と prefix が異なるが、本 resolver は prefix-keyed のため
 * ctx dict も prefix で参照する。ScreenItemsView 側で kind=`message-area` で `listGenericDefinitions`
 * を呼び、prefix=`messageArea` を key として dict に格納する。
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
