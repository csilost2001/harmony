/**
 * @var.<scope>.<name> 補完 Resolver (#1282 Phase 1/2 / #1302 Phase 2-bis / #1316 Phase 3)。
 *
 * Phase 1: scope (flowParameter / action / step / tx / loop / global) の補完
 * Phase 2: flowParameter / action の name 補完
 * Phase 2-bis (#1302): step / tx / loop の id / name 補完を追加。
 *                      global は catalog spec 未確立のため空候補 (#1310 で対応予定)
 * Phase 3 (#1316):
 *   - iterSteps が網羅する nested Step[] を 6 種追加 (branch.elseBranch /
 *     TX.onCommit / TX.onRollback / workflow.on{Approved,Rejected,Timeout} /
 *     validation.inlineBranch.{ok,ng})
 *   - 4-segment 文法 @var.step.<id>.<binding-name> / @var.tx.<id>.<member> 対応
 *   - step / tx scope の候補に trailing: "." 付与 (4-segment 連動 UX)
 *
 * spec 出典: process-flow-variables.md §3.6 / §3.7
 */

import type { CompletionContext, CompletionState, Resolver } from "./types";
import type { ProcessFlow as V3ProcessFlow } from "../../types/v3";

const SCOPE_KEYS = ["flowParameter", "action", "step", "tx", "loop", "global"] as const;

/** TX 外参照可な予約 3 値 (process-flow-variables.md §3.7 / process-flow.v3.schema.json:519) */
const TX_RESERVED_MEMBERS = ["committed", "error", "diagnostics"] as const;

export const varScopeResolver: Resolver = {
  id: "var",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    const before = value.slice(0, cursorPos);

    // Phase 3: @var.step.<id>.<binding-name> / @var.tx.<id>.<member> の name 補完 (4-segment)
    // 先に判定する (3-segment regex より長いので prefix 衝突回避)
    const n3 = before.match(/@var\.(step|tx)\.([\w-]+)\.([\w-]*)$/);
    if (n3) {
      if (!ctx.flow) return null;
      const scope = n3[1];
      const stepId = n3[2];
      const namePrefix = n3[3];

      // 該当 step を flat 列挙から探す (scope === "tx" の場合は kind === "transactionScope" に限定)
      let target: Record<string, unknown> | undefined;
      for (const { step } of iterAllSteps(ctx.flow)) {
        const sAny = step as Record<string, unknown>;
        if (sAny.id !== stepId) continue;
        if (scope === "tx" && sAny.kind !== "transactionScope") continue;
        target = sAny;
        break;
      }
      if (!target) {
        // 該当 step なし: 空候補返却 (active mode、ユーザーは自由入力可)
        return {
          phase: "active",
          resolverId: "var",
          prefix: namePrefix,
          candidates: [],
          replaceLen: namePrefix.length,
        };
      }

      const names = new Set<string>();
      if (scope === "step") {
        // step.outputBinding.name (単一)
        const ob = target.outputBinding as Record<string, unknown> | undefined;
        if (ob?.name && typeof ob.name === "string") names.add(ob.name);
      } else {
        // tx.<id>.<member>: 予約 3 値 (常に利用可) + outputBinding.expose[] (任意 inner var)
        for (const k of TX_RESERVED_MEMBERS) names.add(k);
        const ob = target.outputBinding as Record<string, unknown> | undefined;
        const expose = ob?.expose;
        if (Array.isArray(expose)) {
          for (const k of expose) {
            if (typeof k === "string") names.add(k);
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

    // Phase 2 + Phase 2-bis: @var.<scope>.<name> の name 補完 (3-segment)
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
        // step id を全列挙 (TX/loop/branch/validation/workflow 内 nested 含む)
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
        // 候補 source 未確立 (#1310 follow-up で対応予定)
        // project.json / harmony.json に globals catalog が未定義のため、空候補返却で OK
        // (resolver は active mode、candidates: [] — ユーザーは自由入力可能)
      }

      // step / tx の場合は 4-segment 文法 (@var.step.<id>.<name>) なので
      // 候補に trailing: "." を付けて次段補完を誘発する
      const needsTrailing = scope === "step" || scope === "tx";
      const candidates = [...names]
        .filter((nm) => nm.startsWith(namePrefix))
        .map((v) => (needsTrailing ? { value: v, trailing: "." } : { value: v }));
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

/** flow.actions[].steps[] を再帰列挙 (nested step も含む) */
function* iterAllSteps(flow: V3ProcessFlow): Generator<{ step: unknown }> {
  for (const action of flow.actions) {
    yield* iterSteps(action.steps ?? []);
  }
}

function* iterSteps(steps: unknown[]): Generator<{ step: unknown }> {
  for (const s of steps) {
    yield { step: s };
    const sAny = s as Record<string, unknown>;
    // TX scope: steps[] + onCommit[] + onRollback[] (schema #/$defs/TransactionScopeStep)
    if (sAny.kind === "transactionScope") {
      if (Array.isArray(sAny.steps)) yield* iterSteps(sAny.steps);
      if (Array.isArray(sAny.onCommit)) yield* iterSteps(sAny.onCommit);
      if (Array.isArray(sAny.onRollback)) yield* iterSteps(sAny.onRollback);
    }
    // loop scope
    if (sAny.kind === "loop" && Array.isArray(sAny.steps)) {
      yield* iterSteps(sAny.steps);
    }
    // branch: branches[].steps[] + elseBranch.steps[] (schema #/$defs/BranchStep)
    if (sAny.kind === "branch") {
      if (Array.isArray(sAny.branches)) {
        for (const br of sAny.branches as Record<string, unknown>[]) {
          if (Array.isArray(br.steps)) yield* iterSteps(br.steps);
        }
      }
      const eb = sAny.elseBranch as Record<string, unknown> | undefined;
      if (eb && Array.isArray(eb.steps)) yield* iterSteps(eb.steps);
    }
    // workflow: onApproved[] / onRejected[] / onTimeout[] (schema #/$defs/WorkflowStep)
    if (sAny.kind === "workflow") {
      for (const k of ["onApproved", "onRejected", "onTimeout"] as const) {
        const arr = sAny[k];
        if (Array.isArray(arr)) yield* iterSteps(arr);
      }
    }
    // validation: inlineBranch.{ok,ng}[] (schema #/$defs/ValidationInlineBranch)
    if (sAny.kind === "validation") {
      const ib = sAny.inlineBranch as Record<string, unknown> | undefined;
      if (ib) {
        if (Array.isArray(ib.ok)) yield* iterSteps(ib.ok);
        if (Array.isArray(ib.ng)) yield* iterSteps(ib.ng);
      }
    }
  }
}
