/**
 * @this.<...> 補完 Resolver (#1301 Phase A / #1308 Phase B、designer-time alias)。
 *
 * Phase A (#1301): currentDocumentKind === "screen" のみ完全動作 (Screen editor + ScreenItem context)。
 * Phase B (#1308): 全 kind (screen / processFlow / table / view / viewDefinition / sequence / pageLayout) で
 *   top-level field 補完を support。collection 補完 (`@this.<col>.<id>`) は context に対応 list が
 *   ある場合のみ動作:
 *     - screen.item → ctx.currentScreenItems
 *     - processFlow.action → ctx.flow?.actions
 *     - 他 collection は context list 未供給のため idle (補完候補なし)
 *
 * Phase B-3a (#1322) で validator 側に同等の field 一覧を共有するため、field 名は
 * designerAliasFields.ts に集約。本ファイルは UI 用 hint / trailing を組み合わせる責務のみ。
 *
 * spec: docs/spec/process-flow-prefix-system.md § 11.1
 */

import type { CompletionContext, CompletionState, Resolver } from "./types";
import {
  PAGE_LAYOUT_THIS_TOPLEVEL_FIELD_NAMES,
  PROCESS_FLOW_THIS_TOPLEVEL_FIELD_NAMES,
  SCREEN_THIS_TOPLEVEL_FIELD_NAMES,
  SEQUENCE_THIS_TOPLEVEL_FIELD_NAMES,
  TABLE_THIS_TOPLEVEL_FIELD_NAMES,
  VIEW_DEFINITION_THIS_TOPLEVEL_FIELD_NAMES,
  VIEW_THIS_TOPLEVEL_FIELD_NAMES,
} from "./designerAliasFields";

type DocKind = NonNullable<CompletionContext["currentDocumentKind"]>;

interface FieldDef {
  name: string;
  hint?: string;
  /** collection 系 field (item / action / field / column / region 等) は次に "." を補う。 */
  trailing?: string;
}

const SCREEN_FIELD_META: Record<(typeof SCREEN_THIS_TOPLEVEL_FIELD_NAMES)[number], Omit<FieldDef, "name">> = {
  id: { hint: "screen id" },
  name: { hint: "screen 表示名" },
  purpose: { hint: "用途 (form / list / detail / etc.)" },
  item: { hint: "item.<itemId>...", trailing: "." },
};

// ProcessFlow は他 entity と異なり EntityMeta を継承せず root に `meta` nested。
// id / name / flowType 等は `@this.meta.<field>` 経由でアクセス。
// 一方 `action` collection は spec § 11.1 example に従い singular alias で expose。
const PROCESS_FLOW_FIELD_META: Record<(typeof PROCESS_FLOW_THIS_TOPLEVEL_FIELD_NAMES)[number], Omit<FieldDef, "name">> = {
  meta: { hint: "meta.<field> (id / name / flowType / maturity / sla / etc.)", trailing: "." },
  context: { hint: "context.<catalogs / variables / etc.>", trailing: "." },
  action: { hint: "action.<actionId>... (designer alias、runtime では actions[] へ展開)", trailing: "." },
  expressionLanguage: { hint: "式言語 ('js-subset' / 'cel')" },
};

const TABLE_FIELD_META: Record<(typeof TABLE_THIS_TOPLEVEL_FIELD_NAMES)[number], Omit<FieldDef, "name">> = {
  id: { hint: "table id" },
  name: { hint: "table 表示名" },
  physicalName: { hint: "DB 物理名 (snake_case)" },
  field: { hint: "field.<fieldId>...", trailing: "." },
};

const VIEW_FIELD_META: Record<(typeof VIEW_THIS_TOPLEVEL_FIELD_NAMES)[number], Omit<FieldDef, "name">> = {
  id: { hint: "view id" },
  name: { hint: "view 表示名" },
  physicalName: { hint: "DB 物理名" },
  outputColumn: { hint: "outputColumn.<name>...", trailing: "." },
};

const VIEW_DEFINITION_FIELD_META: Record<(typeof VIEW_DEFINITION_THIS_TOPLEVEL_FIELD_NAMES)[number], Omit<FieldDef, "name">> = {
  id: { hint: "viewDefinition id" },
  name: { hint: "viewDefinition 表示名" },
  kind: { hint: "viewDefinition kind (table / list / kanban / etc.)" },
  column: { hint: "column.<name>...", trailing: "." },
};

const SEQUENCE_FIELD_META: Record<(typeof SEQUENCE_THIS_TOPLEVEL_FIELD_NAMES)[number], Omit<FieldDef, "name">> = {
  id: { hint: "sequence id" },
  name: { hint: "sequence 表示名" },
  physicalName: { hint: "DB 物理名 (例: seq_order_number)" },
  startValue: { hint: "初期値" },
  increment: { hint: "増分" },
  minValue: { hint: "下限値" },
  maxValue: { hint: "上限値" },
  cycle: { hint: "max 到達後に min へ巡回するフラグ" },
  cache: { hint: "キャッシュサイズ" },
};

const PAGE_LAYOUT_FIELD_META: Record<(typeof PAGE_LAYOUT_THIS_TOPLEVEL_FIELD_NAMES)[number], Omit<FieldDef, "name">> = {
  id: { hint: "pageLayout id" },
  name: { hint: "pageLayout 表示名" },
  region: { hint: "region.<name>...", trailing: "." },
};

function expandFields<T extends readonly string[]>(
  names: T,
  meta: Record<T[number], Omit<FieldDef, "name">>,
): FieldDef[] {
  return names.map((name) => ({ name, ...meta[name as T[number]] }));
}

const SCREEN_TOPLEVEL_FIELDS: FieldDef[] = expandFields(SCREEN_THIS_TOPLEVEL_FIELD_NAMES, SCREEN_FIELD_META);
const PROCESS_FLOW_TOPLEVEL_FIELDS: FieldDef[] = expandFields(PROCESS_FLOW_THIS_TOPLEVEL_FIELD_NAMES, PROCESS_FLOW_FIELD_META);
const TABLE_TOPLEVEL_FIELDS: FieldDef[] = expandFields(TABLE_THIS_TOPLEVEL_FIELD_NAMES, TABLE_FIELD_META);
const VIEW_TOPLEVEL_FIELDS: FieldDef[] = expandFields(VIEW_THIS_TOPLEVEL_FIELD_NAMES, VIEW_FIELD_META);
const VIEW_DEFINITION_TOPLEVEL_FIELDS: FieldDef[] = expandFields(VIEW_DEFINITION_THIS_TOPLEVEL_FIELD_NAMES, VIEW_DEFINITION_FIELD_META);
const SEQUENCE_TOPLEVEL_FIELDS: FieldDef[] = expandFields(SEQUENCE_THIS_TOPLEVEL_FIELD_NAMES, SEQUENCE_FIELD_META);
const PAGE_LAYOUT_TOPLEVEL_FIELDS: FieldDef[] = expandFields(PAGE_LAYOUT_THIS_TOPLEVEL_FIELD_NAMES, PAGE_LAYOUT_FIELD_META);

const TOPLEVEL_FIELDS_BY_KIND: Record<DocKind, FieldDef[]> = {
  screen: SCREEN_TOPLEVEL_FIELDS,
  processFlow: PROCESS_FLOW_TOPLEVEL_FIELDS,
  table: TABLE_TOPLEVEL_FIELDS,
  view: VIEW_TOPLEVEL_FIELDS,
  viewDefinition: VIEW_DEFINITION_TOPLEVEL_FIELDS,
  sequence: SEQUENCE_TOPLEVEL_FIELDS,
  pageLayout: PAGE_LAYOUT_TOPLEVEL_FIELDS,
};

export const thisResolver: Resolver = {
  id: "this",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    const kind = ctx.currentDocumentKind;
    if (!kind) return null;

    const before = value.slice(0, cursorPos);

    // Screen: @this.item.<itemId>
    if (kind === "screen") {
      const mItem = before.match(/@this\.item\.([\w-]*)$/);
      if (mItem) {
        const prefix = mItem[1];
        const items = ctx.currentScreenItems ?? [];
        const candidates = items
          .filter((i) => i.id.startsWith(prefix))
          .map((i) => ({ value: i.id, label: i.label ?? i.id }));
        return {
          phase: "active",
          resolverId: "this",
          prefix,
          candidates,
          replaceLen: prefix.length,
        };
      }
    }

    // ProcessFlow: @this.action.<actionId>
    if (kind === "processFlow") {
      const mAction = before.match(/@this\.action\.([\w-]*)$/);
      if (mAction) {
        const prefix = mAction[1];
        const actions = ctx.flow?.actions ?? [];
        const candidates = actions
          .filter((a) => a.id.startsWith(prefix))
          .map((a) => ({ value: a.id, label: a.name ?? a.id }));
        return {
          phase: "active",
          resolverId: "this",
          prefix,
          candidates,
          replaceLen: prefix.length,
        };
      }
    }

    // top-level: @this.<field>
    const mTop = before.match(/@this\.([\w-]*)$/);
    if (mTop) {
      const prefix = mTop[1];
      const fields = TOPLEVEL_FIELDS_BY_KIND[kind] ?? [];
      const candidates = fields
        .filter((f) => f.name.startsWith(prefix))
        .map((f) => ({
          value: f.name,
          label: f.name,
          hint: f.hint,
          trailing: f.trailing,
        }));
      return {
        phase: "active",
        resolverId: "this",
        prefix,
        candidates,
        replaceLen: prefix.length,
      };
    }

    return null;
  },
};
