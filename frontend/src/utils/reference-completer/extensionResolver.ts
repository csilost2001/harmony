/**
 * 拡張 namespace:kindName 補完 Resolver (Phase 3 / #1255)。
 *
 * LoadedExtensions の steps / triggers / fieldTypes / dbOperations / responseTypes を
 * walk して `<namespace>:<kindName>` 形式の候補を生成する。
 *
 * fieldKind="extensionRef" で起動する。
 */

import type { Candidate, CompletionContext, CompletionState, Resolver } from "./types";

/**
 * LoadedExtensions から namespace:kind 形式の候補を列挙する。
 * - steps: Record<"ns:name", StepDef> → namespace:name
 * - triggers: { value: "ns:trigger" }[] → namespace:trigger
 * - fieldTypes (namespace:kind なし、単純 kind のみ) → スキップ
 * - dbOperations (namespace:op) → namespace:op
 * - responseTypes: Record<"ns:type", ...> → namespace:type
 */
function collectExtensionCandidates(ctx: CompletionContext): Candidate[] {
  const ext = ctx.extensions;
  if (!ext) return [];

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const add = (value: string, hint?: string) => {
    if (!seen.has(value)) {
      seen.add(value);
      candidates.push({ value, hint });
    }
  };

  // steps: "namespace:stepName" → namespace:stepName
  for (const key of Object.keys(ext.steps)) {
    if (key.includes(":")) {
      const def = ext.steps[key];
      add(key, def?.label);
    }
  }

  // triggers: { value: "namespace:trigger" }
  for (const t of ext.triggers) {
    if (t.value.includes(":")) {
      add(t.value, t.label);
    }
  }

  // dbOperations: { value: "namespace:op" }
  for (const op of ext.dbOperations) {
    if (op.value.includes(":")) {
      add(op.value, op.label);
    }
  }

  // responseTypes: "namespace:type"
  for (const key of Object.keys(ext.responseTypes)) {
    if (key.includes(":")) {
      add(key);
    }
  }

  return candidates;
}

/** 拡張 namespace:kindName 補完 Resolver。 */
export const extensionResolver: Resolver = {
  id: "extensionRef",

  match(value: string, _cursorPos: number, ctx: CompletionContext): CompletionState | null {
    if (ctx.fieldKind !== "extensionRef") return null;
    if (!ctx.extensions) return null;

    const prefix = value;
    const lowerPrefix = prefix.toLowerCase();
    const all = collectExtensionCandidates(ctx);
    const filtered = all.filter((c) => {
      return c.value.toLowerCase().includes(lowerPrefix) ||
        (c.hint ?? "").toLowerCase().includes(lowerPrefix);
    });

    return {
      phase: "active",
      resolverId: "extensionRef",
      prefix,
      candidates: filtered,
      replaceLen: prefix.length,
    };
  },
};
