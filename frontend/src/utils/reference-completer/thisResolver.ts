/**
 * @this.<...> 補完 Resolver (#1301、designer-time alias)。
 *
 * Phase A: currentDocumentKind === "screen" のみ完全動作。
 *   - @this.item.<itemId>     → currentScreenItems から item id 候補
 *   - @this.item.<itemId>.<field> → 各 item の field 候補 (id/label のみ Phase A、他は Phase B)
 *   - @this.<topLevel>        → screen の top-level field 候補 (name/purpose 等)
 *
 * 他 currentDocumentKind は Phase B で対応 (本 Phase は null を返す = idle)。
 *
 * spec: process-flow-prefix-system.md § 11.1
 */

import type { CompletionContext, CompletionState, Resolver } from "./types";

const SCREEN_TOPLEVEL_FIELDS: { name: string; hint?: string }[] = [
  { name: "id", hint: "screen id" },
  { name: "name", hint: "screen 表示名" },
  { name: "purpose", hint: "用途 (form / list / detail / etc.)" },
  { name: "item", hint: "item.<itemId>..." },
];

export const thisResolver: Resolver = {
  id: "this",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    if (ctx.currentDocumentKind !== "screen") return null;

    const before = value.slice(0, cursorPos);

    // @this.item.<itemId> 補完
    const mItem = before.match(/@this\.item\.([\w-]*)$/);
    if (mItem) {
      const prefix = mItem[1];
      const items = ctx.currentScreenItems ?? [];
      const candidates = items
        .filter((i) => i.id.startsWith(prefix))
        .map((i) => ({ value: i.id, label: i.label ?? i.id }));
      return {
        phase: "active",
        resolverId: "this",
        prefix,
        candidates,
        replaceLen: prefix.length,
      };
    }

    // @this.<topLevel> 補完
    const mTop = before.match(/@this\.([\w-]*)$/);
    if (mTop) {
      const prefix = mTop[1];
      const candidates = SCREEN_TOPLEVEL_FIELDS
        .filter((f) => f.name.startsWith(prefix))
        .map((f) => ({
          value: f.name,
          label: f.name,
          hint: f.hint,
          trailing: f.name === "item" ? "." : undefined,
        }));
      return {
        phase: "active",
        resolverId: "this",
        prefix,
        candidates,
        replaceLen: prefix.length,
      };
    }

    return null;
  },
};
