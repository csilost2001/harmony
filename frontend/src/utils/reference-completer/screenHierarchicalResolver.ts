/**
 * @screen.<screenId>.item.<itemId> 補完 Resolver (#1282)。
 *
 * Phase 1: @screen.<screenId> の補完 (workspace.screens より)。
 * Phase 2: @screen.<screenId>.item.<itemId> の補完 (currentScreenItems より)。
 *          他画面の items は未ロードのため空候補 (本 ISSUE では現画面のみ対応)。
 *
 * spec 出典: process-flow-prefix-system.md §3
 */

import type { CompletionContext, CompletionState, Resolver } from "./types";

export const screenHierarchicalResolver: Resolver = {
  id: "screenHierarchical",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    const before = value.slice(0, cursorPos);

    // Phase 2: @screen.<screenId>.item.<itemId> 補完
    const m2 = before.match(/@screen\.([\w-]+)\.item\.([\w-]*)$/);
    if (m2) {
      const screenId = m2[1];
      const itemPrefix = m2[2];
      // 現画面のみ items 補完 (他画面は未ロードのため空候補)
      const items =
        screenId === ctx.currentScreenId ? (ctx.currentScreenItems ?? []) : [];
      const candidates = items
        .filter((i) => i.id.startsWith(itemPrefix))
        .map((i) => ({ value: i.id, label: i.label ?? i.id }));
      return {
        phase: "active",
        resolverId: "screenHierarchical",
        prefix: itemPrefix,
        candidates,
        replaceLen: itemPrefix.length,
      };
    }

    // Phase 1: @screen.<screenId> 補完
    const m1 = before.match(/@screen\.([\w-]*)$/);
    if (m1) {
      const prefix = m1[1];
      const screens = ctx.workspace?.screens ?? [];
      const lowerPrefix = prefix.toLowerCase();
      const candidates = screens
        .filter(
          (s) =>
            prefix === "" ||
            s.id.startsWith(prefix) ||
            s.name.toLowerCase().includes(lowerPrefix),
        )
        .map((s) => ({
          value: s.id,
          label: s.name,
          hint: s.maturity,
          trailing: ".item.",
        }));
      return {
        phase: "active",
        resolverId: "screenHierarchical",
        prefix,
        candidates,
        replaceLen: prefix.length,
      };
    }

    return null;
  },
};
