/**
 * @var.<scope>.<name> 補完 Resolver (#1282)。
 *
 * Phase 1: scope (flowParameter / action / step / tx / loop / global) の補完 +
 *           flowParameter / action の name 補完まで実装。
 * Phase 2-bis (別 ISSUE): step.<id> / tx.<id> / loop / global の name 補完は未対応。
 *
 * spec 出典: process-flow-variables.md §3.6
 */

import type { CompletionContext, CompletionState, Resolver } from "./types";

const SCOPE_KEYS = ["flowParameter", "action", "step", "tx", "loop", "global"] as const;

export const varScopeResolver: Resolver = {
  id: "var",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    const before = value.slice(0, cursorPos);

    // Phase 2: @var.flowParameter.<name> / @var.action.<name> の name 補完
    const n = before.match(/@var\.(flowParameter|action)\.([\w-]*)$/);
    if (n) {
      if (!ctx.flow) return null;
      const scope = n[1];
      const namePrefix = n[2];
      const names = new Set<string>();
      if (scope === "flowParameter") {
        for (const action of ctx.flow.actions) {
          for (const inp of action.inputs ?? []) {
            if (typeof inp.name === "string") names.add(inp.name);
          }
        }
      } else if (scope === "action") {
        for (const action of ctx.flow.actions) {
          for (const step of action.steps ?? []) {
            const stepAny = step as unknown as Record<string, unknown>;
            const ob = stepAny.outputBinding as Record<string, unknown> | undefined;
            if (ob?.name && typeof ob.name === "string") names.add(ob.name);
          }
        }
      }
      const candidates = [...names]
        .filter((nm) => nm.startsWith(namePrefix))
        .map((v) => ({ value: v }));
      return {
        phase: "active",
        resolverId: "var",
        prefix: namePrefix,
        candidates,
        replaceLen: namePrefix.length,
      };
    }

    // Phase 1: @var.<scope> 補完 (scope は固定 enum)
    const m = before.match(/@var\.([\w-]*)$/);
    if (m) {
      const prefix = m[1];
      const candidates = SCOPE_KEYS.filter((k) => k.startsWith(prefix)).map((k) => ({
        value: k,
        trailing: ".",
      }));
      return {
        phase: "active",
        resolverId: "var",
        prefix,
        candidates,
        replaceLen: prefix.length,
      };
    }

    return null;
  },
};
