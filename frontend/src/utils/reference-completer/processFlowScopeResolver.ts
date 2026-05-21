/**
 * ProcessFlow スコープ式補完 Resolver 群 (Phase 3 / #1255)。
 *
 * @stepResult.<stepId>.<field> / @inputs.<name> / @fieldErrors.<field>
 * の 3 種類のスコープ式を補完する。
 *
 * ctx.flow に ProcessFlow が渡されている場合のみ動作する。
 */

import type { Candidate, CompletionContext, CompletionState, Resolver } from "./types";

/** @stepResult.<stepId>.<field> resolver。 */
export const stepResultResolver: Resolver = {
  id: "stepResult",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    if (!ctx.flow) return null;

    const before = value.slice(0, cursorPos);
    const m = before.match(/@stepResult\.([\w-]*)(?:\.([\w-]*))?$/);
    if (!m) return null;

    const stepIdPart = m[1];
    const fieldPart = m[2];

    // 全 step の id を収集
    const allSteps = ctx.flow.actions.flatMap((action) => action.steps ?? []);

    if (fieldPart === undefined) {
      // stepId 補完フェーズ
      const prefix = stepIdPart ?? "";
      const stepIds = allSteps
        .map((s) => s.id as unknown as string)
        .filter((id): id is string => typeof id === "string" && id.startsWith(prefix));
      const unique = [...new Set(stepIds)];
      const candidates: Candidate[] = unique.map((id) => ({
        value: id,
        trailing: ".",
      }));
      return {
        phase: "active",
        resolverId: "stepResult",
        prefix,
        candidates,
        replaceLen: prefix.length,
      };
    }

    // field 補完フェーズ: 該当 step の outputBinding フィールドまたは dbAccess の SELECT alias
    const targetStep = allSteps.find((s) => (s.id as unknown as string) === stepIdPart);
    if (!targetStep) return null;

    const fields = new Set<string>();

    // outputBinding からフィールド名取得
    const stepAny = targetStep as unknown as Record<string, unknown>;
    const outputBinding = stepAny.outputBinding as Record<string, unknown> | undefined;
    if (outputBinding && typeof outputBinding.name === "string") {
      fields.add(outputBinding.name);
    }

    // dbAccess step の sql フィールドから SELECT alias 抽出
    if (stepAny.kind === "dbAccess") {
      const sql = stepAny.sql as string | undefined;
      if (sql) {
        const aliasMatches = [...sql.matchAll(/\bAS\s+(\w+)/gi)];
        for (const match of aliasMatches) {
          if (match[1]) fields.add(match[1]);
        }
      }
    }

    const prefix = fieldPart;
    const candidates: Candidate[] = [...fields]
      .filter((f) => f.startsWith(prefix))
      .map((f) => ({ value: f }));

    return {
      phase: "active",
      resolverId: "stepResult",
      prefix,
      candidates,
      replaceLen: prefix.length,
    };
  },
};

/** @inputs.<name> resolver。 */
export const inputsResolver: Resolver = {
  id: "inputs",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    if (!ctx.flow) return null;

    const before = value.slice(0, cursorPos);
    const m = before.match(/@inputs\.([\w-]*)$/);
    if (!m) return null;

    const prefix = m[1];

    // 全 action の inputs からフィールド名収集
    const inputNames = new Set<string>();
    for (const action of ctx.flow.actions) {
      for (const input of action.inputs ?? []) {
        if (typeof input.name === "string") {
          inputNames.add(input.name);
        }
      }
    }

    const candidates: Candidate[] = [...inputNames]
      .filter((n) => n.startsWith(prefix))
      .map((n) => ({ value: n }));

    return {
      phase: "active",
      resolverId: "inputs",
      prefix,
      candidates,
      replaceLen: prefix.length,
    };
  },
};

/** @fieldErrors.<field> resolver。 */
export const fieldErrorsResolver: Resolver = {
  id: "fieldErrors",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    if (!ctx.flow) return null;

    const before = value.slice(0, cursorPos);
    const m = before.match(/@fieldErrors\.([\w-]*)$/);
    if (!m) return null;

    const prefix = m[1];

    // 全 step の validation step から fieldErrorsVar を取得
    const fields = new Set<string>();
    for (const action of ctx.flow.actions) {
      for (const step of action.steps ?? []) {
        const stepAny = step as unknown as Record<string, unknown>;
        if (stepAny.kind === "validation") {
          const fieldErrorsVar = stepAny.fieldErrorsVar;
          if (typeof fieldErrorsVar === "string") {
            fields.add(fieldErrorsVar);
          }
          // rules から field 名も収集
          const rules = stepAny.rules as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(rules)) {
            for (const rule of rules) {
              const field = rule.field;
              if (typeof field === "string") {
                fields.add(field);
              }
            }
          }
        }
      }
    }

    const candidates: Candidate[] = [...fields]
      .filter((f) => f.startsWith(prefix))
      .map((f) => ({ value: f }));

    return {
      phase: "active",
      resolverId: "fieldErrors",
      prefix,
      candidates,
      replaceLen: prefix.length,
    };
  },
};

/** 全 processFlow スコープ resolver のデフォルトセット。 */
export const ALL_PROCESS_FLOW_SCOPE_RESOLVERS: Resolver[] = [
  stepResultResolver,
  inputsResolver,
  fieldErrorsResolver,
];
