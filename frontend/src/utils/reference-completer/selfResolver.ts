/**
 * @self.<field> 補完 Resolver (#1301、designer-time alias)。
 *
 * Phase A: currentSelfRef.kind === "screenItem" のみ完全動作。
 *   - @self.<field> → ScreenItem field 候補 (id/label/value/readonly/enabled/visible/errors/...)
 *
 * 他 kind (step / column) は Phase B で対応 (本 Phase は null を返す = idle)。
 *
 * spec: process-flow-prefix-system.md § 11.2
 */

import type { CompletionContext, CompletionState, Resolver } from "./types";

const SCREEN_ITEM_FIELDS: { name: string; hint?: string }[] = [
  { name: "id", hint: "item id (string)" },
  { name: "label", hint: "表示 label (string)" },
  { name: "value", hint: "current value (any)" },
  { name: "readonly", hint: "読取専用フラグ (boolean)" },
  { name: "enabled", hint: "活性フラグ (boolean)" },
  { name: "visible", hint: "表示フラグ (boolean)" },
  { name: "errors", hint: "エラー配列 (string[])" },
  { name: "options", hint: "選択肢 (options 系 item のみ)" },
];

export const selfResolver: Resolver = {
  id: "self",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    if (ctx.currentSelfRef?.kind !== "screenItem") return null;

    const before = value.slice(0, cursorPos);

    // @self.<field> 補完
    const m = before.match(/@self\.([\w-]*)$/);
    if (!m) return null;

    const prefix = m[1];
    const fields = ctx.currentSelfRef.fields ?? SCREEN_ITEM_FIELDS;
    const candidates = fields
      .filter((f) => f.name.startsWith(prefix))
      .map((f) => ({
        value: f.name,
        label: f.name,
        hint: "hint" in f ? f.hint : undefined,
      }));

    return {
      phase: "active",
      resolverId: "self",
      prefix,
      candidates,
      replaceLen: prefix.length,
    };
  },
};
