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
 * Phase B-3 (#1322) で runtime / codegen 側の pre-resolve を実装予定。
 *
 * spec: docs/spec/process-flow-prefix-system.md § 11.1
 */

import type { CompletionContext, CompletionState, Resolver } from "./types";

type DocKind = NonNullable<CompletionContext["currentDocumentKind"]>;

interface FieldDef {
  name: string;
  hint?: string;
  /** collection 系 field (item / action / field / column / region 等) は次に "." を補う。 */
  trailing?: string;
}

const SCREEN_TOPLEVEL_FIELDS: FieldDef[] = [
  { name: "id", hint: "screen id" },
  { name: "name", hint: "screen 表示名" },
  { name: "purpose", hint: "用途 (form / list / detail / etc.)" },
  { name: "item", hint: "item.<itemId>...", trailing: "." },
];

// ProcessFlow は他 entity と異なり EntityMeta を継承せず root に `meta` nested。
// id / name / flowType 等は `@this.meta.<field>` 経由でアクセス。
// 一方 `action` collection は spec § 11.1 example に従い singular alias で expose。
const PROCESS_FLOW_TOPLEVEL_FIELDS: FieldDef[] = [
  { name: "meta", hint: "meta.<field> (id / name / flowType / maturity / sla / etc.)", trailing: "." },
  { name: "context", hint: "context.<catalogs / variables / etc.>", trailing: "." },
  { name: "action", hint: "action.<actionId>... (designer alias、runtime では actions[] へ展開)", trailing: "." },
  { name: "expressionLanguage", hint: "式言語 ('js-subset' / 'cel')" },
];

const TABLE_TOPLEVEL_FIELDS: FieldDef[] = [
  { name: "id", hint: "table id" },
  { name: "name", hint: "table 表示名" },
  { name: "physicalName", hint: "DB 物理名 (snake_case)" },
  { name: "field", hint: "field.<fieldId>...", trailing: "." },
];

const VIEW_TOPLEVEL_FIELDS: FieldDef[] = [
  { name: "id", hint: "view id" },
  { name: "name", hint: "view 表示名" },
  { name: "physicalName", hint: "DB 物理名" },
  { name: "outputColumn", hint: "outputColumn.<name>...", trailing: "." },
];

const VIEW_DEFINITION_TOPLEVEL_FIELDS: FieldDef[] = [
  { name: "id", hint: "viewDefinition id" },
  { name: "name", hint: "viewDefinition 表示名" },
  { name: "kind", hint: "viewDefinition kind (table / list / kanban / etc.)" },
  { name: "column", hint: "column.<name>...", trailing: "." },
];

const SEQUENCE_TOPLEVEL_FIELDS: FieldDef[] = [
  { name: "id", hint: "sequence id" },
  { name: "name", hint: "sequence 表示名" },
  { name: "physicalName", hint: "DB 物理名 (例: seq_order_number)" },
  { name: "startValue", hint: "初期値" },
  { name: "increment", hint: "増分" },
  { name: "minValue", hint: "下限値" },
  { name: "maxValue", hint: "上限値" },
  { name: "cycle", hint: "max 到達後に min へ巡回するフラグ" },
  { name: "cache", hint: "キャッシュサイズ" },
];

const PAGE_LAYOUT_TOPLEVEL_FIELDS: FieldDef[] = [
  { name: "id", hint: "pageLayout id" },
  { name: "name", hint: "pageLayout 表示名" },
  { name: "region", hint: "region.<name>...", trailing: "." },
];

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
