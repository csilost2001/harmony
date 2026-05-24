/**
 * `@this` / `@self` designer-time alias の **静的 pre-resolve** util (#1322 Phase B-3b)。
 *
 * 設計思想:
 *  - ProcessFlow JSON / Screen JSON は `@this/@self` を保持したまま永続化する (designer の補完が
 *    展開後の specific id に依存しないため、画面 id / step id の rename にロバスト)
 *  - runtime 評価 / codegen 直前に本 util で **structured resolution** に展開する
 *  - runtime evaluator は `@this/@self` を直接認識しない設計とし、本 util の出力 (canonical kind) のみ評価
 *
 * 本 module の責務:
 *  - 1 件の `@this.<...>` / `@self.<...>` 参照を解析し、context (flowId / stepId / screenId) と
 *    照合して `DesignerAliasResolution` 構造体を返す純粋関数 `resolveDesignerAlias`
 *  - template string 全体を走査して全 alias 参照を `DesignerAliasMatch[]` として列挙する
 *    helper `findDesignerAliases`
 *
 * 本 module は実際の文字列置換 / 値解決は行わない。codegen target 側 (TypeScript / Java / SQL 等) が
 * 各 `DesignerAliasResolution` を target 言語の構文に変換する責務を持つ。
 *
 * spec: docs/spec/process-flow-prefix-system.md § 11.3 "runtime / codegen 静的 pre-resolve"
 */

import {
  PROCESS_FLOW_META_FIELD_NAMES,
  PROCESS_FLOW_THIS_TOPLEVEL_FIELD_NAMES,
  SCREEN_THIS_TOPLEVEL_FIELD_NAMES,
  SELF_SCREEN_ITEM_FIELD_NAMES,
  SELF_STEP_FIELD_NAMES,
} from "./designerAliasFields";

const PROCESS_FLOW_THIS_TOPLEVEL_SET: ReadonlySet<string> = new Set(PROCESS_FLOW_THIS_TOPLEVEL_FIELD_NAMES);
const PROCESS_FLOW_META_SET: ReadonlySet<string> = new Set(PROCESS_FLOW_META_FIELD_NAMES);
const SCREEN_THIS_TOPLEVEL_SET: ReadonlySet<string> = new Set(SCREEN_THIS_TOPLEVEL_FIELD_NAMES);
const SELF_STEP_SET: ReadonlySet<string> = new Set(SELF_STEP_FIELD_NAMES);
const SELF_SCREEN_ITEM_SET: ReadonlySet<string> = new Set(SELF_SCREEN_ITEM_FIELD_NAMES);

/** ProcessFlow editor の `@this/@self` 解決 context。 */
export type ProcessFlowAliasContext = {
  editorKind: "processFlow";
  /** 現在編集中の flow の id (`@this` の展開先) */
  flowId: string;
  /** 現在 walk / edit 中の step の id (`@self` の展開先)。 step context 外 (e.g. action.inputs[]) は undefined */
  stepId?: string;
  /** step kind (debug / log 用、結果には含めない) */
  stepKind?: string;
};

/** Screen editor の `@this/@self` 解決 context (#1301 Phase A、Phase B-3b で formal 定義)。 */
export type ScreenAliasContext = {
  editorKind: "screen";
  /** 現在編集中の screen の id (`@this` の展開先) */
  screenId: string;
  /** 現在編集中の screen item の id (`@self` の展開先、ScreenItemsView 等) */
  itemId?: string;
};

export type DesignerAliasContext = ProcessFlowAliasContext | ScreenAliasContext;

/**
 * `@this` / `@self` を解決した結果。kind 別 metadata を持つ discriminated union。
 *
 * codegen target 側で kind を switch して target 言語の構文に変換する設計。
 * 例: TypeScript / NestJS codegen で `kind === "stepSelf"` なら `this.<field>` に展開、
 *     SQL codegen で `kind === "flowMeta"` なら埋め込み literal に展開、等。
 */
export type DesignerAliasResolution =
  // ── ProcessFlow editor ─────────────────────────────────────────────────────
  /** `@this.action.<actionId>.<path>` — flow.actions[].id 経由の action 参照 */
  | { kind: "flowAction"; flowId: string; actionId: string; path: string[] }
  /** `@this.meta.<field>.<path>` — flow.meta.<field> 経由 */
  | { kind: "flowMeta"; flowId: string; field: string; path: string[] }
  /** `@this.context.<path>` — flow.context (catalogs / variables 等) */
  | { kind: "flowContext"; flowId: string; path: string[] }
  /** `@this.expressionLanguage` — flow.expressionLanguage (leaf) */
  | { kind: "flowExpressionLanguage"; flowId: string }
  /** `@self.<field>.<path>` (step context) — 現在 step の field */
  | { kind: "stepSelf"; stepId: string; field: string; path: string[] }
  // ── Screen editor ──────────────────────────────────────────────────────────
  /** `@this.item.<itemId>.<path>` — screen.items[].id 経由 */
  | { kind: "screenItem"; screenId: string; itemId: string; path: string[] }
  /** `@this.<field>.<path>` (screen top-level、id / name / purpose) */
  | { kind: "screenTopLevel"; screenId: string; field: string; path: string[] }
  /** `@self.<field>.<path>` (screenItem context) — 現在 item の field */
  | { kind: "screenItemSelf"; screenId: string; itemId: string; field: string; path: string[] }
  // ── エラー ─────────────────────────────────────────────────────────────────
  /** 解決失敗 (context 不在 / unknown field 等)。Phase B-3a validator で error として捕捉済の前提。 */
  | { kind: "unresolved"; reason: string };

/** 1 件の alias match (string 内の出現位置 + 解決結果)。 */
export type DesignerAliasMatch = {
  /** 元 string 内の絶対 offset (0-based) */
  offset: number;
  /** match した文字列の length (`@<alias>.<segments>` 全体) */
  length: number;
  /** match した元文字列 (例: `"@this.action.action-1.outputBinding"`) */
  original: string;
  /** どちらの alias prefix か */
  alias: "this" | "self";
  /** alias 後の segments (`@this.action.action-1.outputBinding` なら `["action", "action-1", "outputBinding"]`) */
  segments: string[];
  /** 構造化 resolution */
  resolution: DesignerAliasResolution;
};

// (?<![a-zA-Z0-9_]) negative lookbehind は processFlowAntipatternValidator と同方針 (email 等の
// false positive 回避)。alias key 部は `[a-zA-Z0-9_.-]` を許容し、UUID / LocalId / camelCase を扱う。
const ALIAS_RE = /(?<![a-zA-Z0-9_])@(this|self)\.([a-zA-Z0-9_][a-zA-Z0-9_.-]*)/g;

/**
 * 1 件の `@this.<...>` / `@self.<...>` を解析して `DesignerAliasResolution` を返す純粋関数。
 *
 * @param alias "this" or "self"
 * @param segments alias 後の segments (例: `["action", "action-1", "outputBinding"]`)
 * @param ctx 解決 context
 */
export function resolveDesignerAlias(
  alias: "this" | "self",
  segments: string[],
  ctx: DesignerAliasContext,
): DesignerAliasResolution {
  if (segments.length === 0) {
    return { kind: "unresolved", reason: "alias 後の segments が空" };
  }
  const head = segments[0];

  if (ctx.editorKind === "processFlow") {
    if (alias === "this") {
      if (!PROCESS_FLOW_THIS_TOPLEVEL_SET.has(head)) {
        return { kind: "unresolved", reason: `@this.${head} は ProcessFlow editor の許可 top-level field ではない` };
      }
      if (head === "action") {
        const actionId = segments[1];
        if (!actionId) {
          return { kind: "unresolved", reason: "@this.action の後に action id が必要" };
        }
        return { kind: "flowAction", flowId: ctx.flowId, actionId, path: segments.slice(2) };
      }
      if (head === "meta") {
        const field = segments[1];
        if (!field || !PROCESS_FLOW_META_SET.has(field)) {
          return { kind: "unresolved", reason: `@this.meta.${field ?? "<empty>"} は許可 meta field ではない` };
        }
        return { kind: "flowMeta", flowId: ctx.flowId, field, path: segments.slice(2) };
      }
      if (head === "context") {
        return { kind: "flowContext", flowId: ctx.flowId, path: segments.slice(1) };
      }
      if (head === "expressionLanguage") {
        return { kind: "flowExpressionLanguage", flowId: ctx.flowId };
      }
      // PROCESS_FLOW_THIS_TOPLEVEL_SET にあるが上記分岐に無いケースは新規 field 追加忘れ
      return { kind: "unresolved", reason: `@this.${head} の解決ロジック未実装 (designerAliasResolve.ts の更新が必要)` };
    }
    // alias === "self"
    if (!ctx.stepId) {
      return { kind: "unresolved", reason: "step context 外 (`@self` は step body 内でのみ有効)" };
    }
    if (!SELF_STEP_SET.has(head)) {
      return { kind: "unresolved", reason: `@self.${head} は step 共通 field (${[...SELF_STEP_SET].join(" / ")}) ではない` };
    }
    return { kind: "stepSelf", stepId: ctx.stepId, field: head, path: segments.slice(1) };
  }

  // ctx.editorKind === "screen"
  if (alias === "this") {
    if (!SCREEN_THIS_TOPLEVEL_SET.has(head)) {
      return { kind: "unresolved", reason: `@this.${head} は Screen editor の許可 top-level field ではない` };
    }
    if (head === "item") {
      const itemId = segments[1];
      if (!itemId) {
        return { kind: "unresolved", reason: "@this.item の後に item id が必要" };
      }
      return { kind: "screenItem", screenId: ctx.screenId, itemId, path: segments.slice(2) };
    }
    return { kind: "screenTopLevel", screenId: ctx.screenId, field: head, path: segments.slice(1) };
  }
  // alias === "self" (screen context = screenItem)
  if (!ctx.itemId) {
    return { kind: "unresolved", reason: "screenItem context 外 (`@self` は items table 行 / events panel 等の item-bound context でのみ有効)" };
  }
  if (!SELF_SCREEN_ITEM_SET.has(head)) {
    return { kind: "unresolved", reason: `@self.${head} は screenItem 共通 field (${[...SELF_SCREEN_ITEM_SET].join(" / ")}) ではない` };
  }
  return { kind: "screenItemSelf", screenId: ctx.screenId, itemId: ctx.itemId, field: head, path: segments.slice(1) };
}

/**
 * template 文字列を走査し、`@this.*` / `@self.*` を全件抽出して `DesignerAliasMatch[]` を返す。
 *
 * codegen target は本関数で alias 出現を全件取得した後、`match.resolution` を見て target 言語の
 * 構文に変換し、元 string 内で `match.offset` ～ `match.offset + match.length` の範囲を置換する。
 */
export function findDesignerAliases(
  template: string,
  ctx: DesignerAliasContext,
): DesignerAliasMatch[] {
  const matches: DesignerAliasMatch[] = [];
  ALIAS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ALIAS_RE.exec(template)) !== null) {
    const alias = m[1] as "this" | "self";
    const keyPart = m[2];
    const segments = keyPart.split(".");
    const resolution = resolveDesignerAlias(alias, segments, ctx);
    matches.push({
      offset: m.index,
      length: m[0].length,
      original: m[0],
      alias,
      segments,
      resolution,
    });
  }
  return matches;
}
