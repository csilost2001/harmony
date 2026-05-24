/**
 * `@this` / `@self` designer-time alias の許可 field 一覧 (共通定義、#1322 Phase B-3a)。
 *
 * thisResolver.ts / selfResolver.ts (designer 補完 UI) と
 * processFlowAntipatternValidator.ts (validator) の両者で共有する。
 *
 * 設計方針:
 *  - 名前のみを export (補完 UI 用の hint / trailing は各 resolver 側で局所的に hold)
 *  - field 名追加時はここを更新すれば validator / 補完の両方に伝播
 *  - validator は ProcessFlow 配下の文字列値のみ走査するため、本モジュールが提供する
 *    定数の中で実際に validator で参照されるのは `PROCESS_FLOW_*` / `SELF_STEP_*` のみ
 *
 * spec:
 *  - docs/spec/process-flow-prefix-system.md § 11.1 (`@this`)
 *  - docs/spec/process-flow-prefix-system.md § 11.2 (`@self`)
 */

/** Screen editor で `@this.<field>` 直後に来る許可 field 名。 */
export const SCREEN_THIS_TOPLEVEL_FIELD_NAMES = ["id", "name", "purpose", "item"] as const;

/** ProcessFlow editor で `@this.<field>` 直後に来る許可 field 名。 */
export const PROCESS_FLOW_THIS_TOPLEVEL_FIELD_NAMES = [
  "meta",
  "context",
  "action",
  "expressionLanguage",
] as const;

/** Table editor で `@this.<field>` 直後に来る許可 field 名。 */
export const TABLE_THIS_TOPLEVEL_FIELD_NAMES = ["id", "name", "physicalName", "field"] as const;

/** View editor で `@this.<field>` 直後に来る許可 field 名。 */
export const VIEW_THIS_TOPLEVEL_FIELD_NAMES = [
  "id",
  "name",
  "physicalName",
  "outputColumn",
] as const;

/** ViewDefinition editor で `@this.<field>` 直後に来る許可 field 名。 */
export const VIEW_DEFINITION_THIS_TOPLEVEL_FIELD_NAMES = [
  "id",
  "name",
  "kind",
  "column",
] as const;

/** Sequence editor で `@this.<field>` 直後に来る許可 field 名 (collection 無し、flat 構造)。 */
export const SEQUENCE_THIS_TOPLEVEL_FIELD_NAMES = [
  "id",
  "name",
  "physicalName",
  "startValue",
  "increment",
  "minValue",
  "maxValue",
  "cycle",
  "cache",
] as const;

/** PageLayout editor で `@this.<field>` 直後に来る許可 field 名。 */
export const PAGE_LAYOUT_THIS_TOPLEVEL_FIELD_NAMES = ["id", "name", "region"] as const;

/**
 * ProcessFlow `@this.meta.<field>` の許可 field 名。
 *
 * EntityMeta (common.v3.schema.json) + ProcessFlow Meta 固有 field の和集合。
 * 設計者拡張で新 field が増える可能性も考慮し、validator では unknown field は warning のみ
 * (silent pass を選ぶか broken-ref 報告かは caller 側で判定)。
 */
export const PROCESS_FLOW_META_FIELD_NAMES = [
  // common.v3.schema.json#/$defs/EntityMeta
  "id",
  "name",
  "description",
  "version",
  "maturity",
  "createdAt",
  "updatedAt",
  // process-flow.v3.schema.json#/$defs/Meta 固有
  "flowType",
  "screenId",
  "apiVersion",
  "mode",
  "sla",
  "primaryInvoker",
] as const;

/**
 * `@self.<field>` for step context — ProcessFlow step 共通 field。
 *
 * 各 step kind に固有の field (例: dbAccess.sql / componentCall.componentRef) は
 * `@self.<kindSpecificField>` ではなく `@self.outputBinding.<sub>` 経由か、step
 * 本体に直書きするため、本一覧は kind 共通 field のみに限定する。
 */
export const SELF_STEP_FIELD_NAMES = [
  "id",
  "description",
  "runIf",
  "outputBinding",
  "compensatesFor",
] as const;

/** `@self.<field>` for screenItem context. */
export const SELF_SCREEN_ITEM_FIELD_NAMES = [
  "id",
  "label",
  "value",
  "readonly",
  "enabled",
  "visible",
  "errors",
  "options",
] as const;

/** `@self.<field>` for table column context. */
export const SELF_COLUMN_FIELD_NAMES = [
  "id",
  "physicalName",
  "name",
  "dataType",
  "notNull",
  "primaryKey",
  "defaultValue",
  "comment",
] as const;

/** `@self.<field>` for pageLayout region context. */
export const SELF_REGION_FIELD_NAMES = ["name", "description"] as const;
