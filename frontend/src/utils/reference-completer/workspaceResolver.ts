/**
 * workspace 参照 ID 補完 Resolver 群 (Phase 2 / #1255)。
 *
 * fieldKind を判定キーとして各 resolver を起動する。
 * テキスト全体を prefix として contains フィルタで候補を絞り込む。
 */

import type { Candidate, CompletionContext, CompletionState, Resolver } from "./types";

/**
 * fieldKind ベースの ID/name resolver を生成するファクトリ。
 * value 全体を prefix とみなし、contains マッチで候補を絞り込む。
 */
function makeIdResolver(
  fieldKind: string,
  source: (ctx: CompletionContext) => Candidate[],
): Resolver {
  return {
    id: fieldKind,
    match(value: string, _cursorPos: number, ctx: CompletionContext): CompletionState | null {
      if (ctx.fieldKind !== fieldKind) return null;
      const prefix = value;
      const lowerPrefix = prefix.toLowerCase();
      const all = source(ctx);
      const filtered = all.filter((c) => {
        const val = c.value.toLowerCase();
        const lbl = (c.label ?? "").toLowerCase();
        return val.includes(lowerPrefix) || lbl.includes(lowerPrefix);
      });
      return {
        phase: "active",
        resolverId: fieldKind,
        prefix,
        candidates: filtered,
        replaceLen: prefix.length,
      };
    },
  };
}

/** screenId 補完: workspace の全 Screen (id + name)。 */
export const screenIdResolver = makeIdResolver("screenId", (ctx) =>
  (ctx.workspace?.screens ?? []).map((s) => ({
    value: s.id,
    label: s.name,
    hint: s.maturity,
  })),
);

/** tableId 補完: workspace の全 Table (id + physicalName + name)。 */
export const tableIdResolver = makeIdResolver("tableId", (ctx) =>
  (ctx.workspace?.tables ?? []).map((t) => ({
    value: t.id,
    label: `${t.name}（${t.physicalName}）`,
    hint: t.maturity,
  })),
);

/** viewDefinitionId 補完: workspace の全 ViewDefinition (id + name)。 */
export const viewDefinitionIdResolver = makeIdResolver("viewDefinitionId", (ctx) =>
  (ctx.workspace?.viewDefinitions ?? []).map((v) => ({
    value: v.id,
    label: v.name,
    hint: v.maturity,
  })),
);

/** handlerFlowId 補完: workspace の全 ProcessFlow (id + name)。 */
export const handlerFlowIdResolver = makeIdResolver("handlerFlowId", (ctx) =>
  (ctx.workspace?.processFlows ?? []).map((f) => ({
    value: f.id,
    label: f.name,
    hint: f.kind,
  })),
);

/**
 * handlerActionId 補完: ctx.handlerFlowId で指定された ProcessFlow の actions[].id。
 * handlerFlowId が指定されていない場合は全 flow の actions を列挙する。
 */
export const handlerActionIdResolver = makeIdResolver("handlerActionId", (ctx) => {
  const flows = ctx.workspace?.processFlows ?? [];
  if (ctx.handlerFlowId) {
    const target = flows.find((f) => f.id === ctx.handlerFlowId);
    return (target?.actions ?? []).map((a) => ({
      value: a.id,
      label: a.name ?? a.id,
    }));
  }
  // handlerFlowId 未指定時: 全フローの actions を列挙
  return flows.flatMap((f) =>
    (f.actions ?? []).map((a) => ({
      value: a.id,
      label: a.name ?? a.id,
      hint: f.name,
    })),
  );
});

/** fragmentRef 補完: ui-fragment 汎用定義の name。 */
export const fragmentRefResolver = makeIdResolver("fragmentRef", (ctx) =>
  (ctx.workspace?.fragments ?? []).map((d) => ({ value: d.name })),
);

/** componentRef 補完: component-definition 汎用定義の name。 */
export const componentRefResolver = makeIdResolver("componentRef", (ctx) =>
  (ctx.workspace?.components ?? []).map((d) => ({ value: d.name })),
);

/** exceptionTypeRef 補完: exception-type 汎用定義の name。 */
export const exceptionTypeRefResolver = makeIdResolver("exceptionTypeRef", (ctx) =>
  (ctx.workspace?.exceptionTypes ?? []).map((d) => ({ value: d.name })),
);

/** modelRef 補完: projectCatalogs の modelEndpoints キー。 */
export const modelRefResolver = makeIdResolver("modelRef", (ctx) =>
  (ctx.workspace?.modelEndpoints ?? []).map((m) => ({
    value: m.id,
    label: m.name ?? m.id,
  })),
);

/** secretRef 補完: projectCatalogs の secrets キー。 */
export const secretRefResolver = makeIdResolver("secretRef", (ctx) =>
  (ctx.workspace?.secrets ?? []).map((s) => ({
    value: s.id,
    label: s.name ?? s.id,
  })),
);

/** topic 補完: eventCatalog の topic 一覧。 */
export const topicResolver = makeIdResolver("topic", (ctx) =>
  (ctx.workspace?.events ?? []).map((e) => ({
    value: e.topic,
    hint: e.description,
  })),
);

/** 全 workspace resolver のデフォルトセット。 */
export const ALL_WORKSPACE_RESOLVERS: Resolver[] = [
  screenIdResolver,
  tableIdResolver,
  viewDefinitionIdResolver,
  handlerFlowIdResolver,
  handlerActionIdResolver,
  fragmentRefResolver,
  componentRefResolver,
  exceptionTypeRefResolver,
  modelRefResolver,
  secretRefResolver,
  topicResolver,
];
