/**
 * 画面項目 type フィールド補完 Resolver (#1260 Phase 4)。
 *
 * primitive (string / number / ...) + fieldType extension (namespace:kind) を統合した候補を返す。
 * fieldKind の制約なし (常に active を返す) で、ScreenItemsView の type 列専用として使用する。
 */

import type { Candidate, CompletionContext, Resolver } from "../../utils/reference-completer/types";
import { PRIMITIVE_TYPES } from "./internal/screenItemsConstants";

/** 画面項目 type フィールド用補完 Resolver。primitive + fieldType extension を統合する。 */
export const screenItemTypeResolver: Resolver = {
  id: "screenItemType",

  match(value: string, _cursorPos: number, ctx: CompletionContext) {
    const lower = value.toLowerCase();

    const primitives: Candidate[] = (PRIMITIVE_TYPES as readonly string[]).map((t) => ({
      value: t,
      hint: "primitive",
    }));

    const extensions: Candidate[] = [];
    const seen = new Set<string>();
    for (const ft of ctx.extensions?.fieldTypes ?? []) {
      if (ft.namespace) {
        const full = `${ft.namespace}:${ft.kind}`;
        if (!seen.has(full)) {
          seen.add(full);
          extensions.push({ value: full, hint: ft.label });
        }
      }
    }

    const all = [...primitives, ...extensions].filter((c) =>
      c.value.toLowerCase().includes(lower) ||
      (c.hint ?? "").toLowerCase().includes(lower),
    );

    return {
      phase: "active",
      resolverId: "screenItemType",
      prefix: value,
      candidates: all,
      replaceLen: value.length,
    };
  },
};
