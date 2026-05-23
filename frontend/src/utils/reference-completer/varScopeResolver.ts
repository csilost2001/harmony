/**
 * @var.<scope>.<name> 補完 Resolver (#1282 Phase 1/2 / #1302 Phase 2-bis)。
 *
 * Phase 1: scope (flowParameter / action / step / tx / loop / global) の補完
 * Phase 2: flowParameter / action の name 補完
 * Phase 2-bis (#1302): step / tx / loop の name 補完を追加。
 *                      global は catalog spec 未確立のため空候補 (別 ISSUE で対応予定)
 *
 * spec 出典: process-flow-variables.md §3.6
 */

import type { CompletionContext, CompletionState, Resolver } from "./types";
import type { ProcessFlow as V3ProcessFlow } from "../../types/v3";

const SCOPE_KEYS = ["flowParameter", "action", "step", "tx", "loop", "global"] as const;

export const varScopeResolver: Resolver = {
  id: "var",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    const before = value.slice(0, cursorPos);

    // Phase 2 + Phase 2-bis: @var.<scope>.<name> の name 補完
    const n = before.match(/@var\.(flowParameter|action|step|tx|loop|global)\.([\w-]*)$/);
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
      } else if (scope === "step") {
        // step id を全列挙 (TX/loop/branch 内 nested 含む)
        for (const { step } of iterAllSteps(ctx.flow)) {
          const sAny = step as Record<string, unknown>;
          if (typeof sAny.id === "string") names.add(sAny.id);
        }
      } else if (scope === "tx") {
        // kind === "transactionScope" の id のみ
        for (const { step } of iterAllSteps(ctx.flow)) {
          const sAny = step as Record<string, unknown>;
          if (sAny.kind === "transactionScope" && typeof sAny.id === "string") {
            names.add(sAny.id);
          }
        }
      } else if (scope === "loop") {
        // loop step の collectionItemName / collectionIndexName / outputBinding.name
        for (const { step } of iterAllSteps(ctx.flow)) {
          const sAny = step as Record<string, unknown>;
          if (sAny.kind === "loop") {
            if (typeof sAny.collectionItemName === "string") names.add(sAny.collectionItemName);
            if (typeof sAny.collectionIndexName === "string") names.add(sAny.collectionIndexName);
            const ob = sAny.outputBinding as Record<string, unknown> | undefined;
            if (ob?.name && typeof ob.name === "string") names.add(ob.name);
          }
        }
      } else if (scope === "global") {
        // 候補 source 未確立 (spec/schema governance 未対応、別 ISSUE 起票済)
        // 空候補返却で OK (resolver は active mode、candidates: [])
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

/** flow.actions[].steps[] を再帰列挙 (TX/loop/branch 内の nested step も含む) */
function* iterAllSteps(flow: V3ProcessFlow): Generator<{ step: unknown }> {
  for (const action of flow.actions) {
    yield* iterSteps(action.steps ?? []);
  }
}

function* iterSteps(steps: unknown[]): Generator<{ step: unknown }> {
  for (const s of steps) {
    yield { step: s };
    const sAny = s as Record<string, unknown>;
    // TX scope の子 step
    if (sAny.kind === "transactionScope" && Array.isArray(sAny.steps)) {
      yield* iterSteps(sAny.steps);
    }
    // loop scope の子 step
    if (sAny.kind === "loop" && Array.isArray(sAny.steps)) {
      yield* iterSteps(sAny.steps);
    }
    // branch scope の子 step
    if (sAny.kind === "branch" && Array.isArray(sAny.branches)) {
      for (const br of sAny.branches as Record<string, unknown>[]) {
        if (Array.isArray(br.steps)) yield* iterSteps(br.steps);
      }
    }
  }
}
