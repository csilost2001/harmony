/**
 * @self.<field> 補完 Resolver (#1301 Phase A / #1308 Phase B、designer-time alias)。
 *
 * Phase A (#1301): currentSelfRef.kind === "screenItem" のみ完全動作。
 * Phase B (#1308): 全 kind (screenItem / step / column / region) で field 補完を support。
 *   - 各 kind の default fields table を定義
 *   - currentSelfRef.fields でケース毎に override 可
 *
 * Phase B-3 (#1322) で validator / runtime / codegen 側の context 解決を実装予定。
 *
 * spec: docs/spec/process-flow-prefix-system.md § 11.2
 */

import type { CompletionContext, CompletionState, Resolver } from "./types";

interface FieldDef {
  name: string;
  hint?: string;
}

const SCREEN_ITEM_FIELDS: FieldDef[] = [
  { name: "id", hint: "item id (string)" },
  { name: "label", hint: "表示 label (string)" },
  { name: "value", hint: "current value (any)" },
  { name: "readonly", hint: "読取専用フラグ (boolean)" },
  { name: "enabled", hint: "活性フラグ (boolean)" },
  { name: "visible", hint: "表示フラグ (boolean)" },
  { name: "errors", hint: "エラー配列 (string[])" },
  { name: "options", hint: "選択肢 (options 系 item のみ)" },
];

const STEP_FIELDS: FieldDef[] = [
  { name: "id", hint: "step id (LocalId)" },
  { name: "description", hint: "step 説明" },
  { name: "runIf", hint: "実行条件式 (TemplateString)" },
  { name: "outputBinding", hint: "outputBinding object (name / expose / transformations)" },
  { name: "compensatesFor", hint: "Saga 補償対象 step.id" },
];

const COLUMN_FIELDS: FieldDef[] = [
  { name: "id", hint: "column id (LocalId)" },
  { name: "physicalName", hint: "DB 物理名 (snake_case)" },
  { name: "name", hint: "表示名" },
  { name: "dataType", hint: "DataType (VARCHAR / INTEGER / etc.)" },
  { name: "notNull", hint: "NOT NULL フラグ" },
  { name: "primaryKey", hint: "PRIMARY KEY フラグ" },
  { name: "defaultValue", hint: "DEFAULT 値 (literal / 式)" },
  { name: "comment", hint: "DDL カラムコメント" },
];

const REGION_FIELDS: FieldDef[] = [
  { name: "name", hint: "region 名 (header / sidebar / footer / main / custom)" },
  { name: "description", hint: "region の用途説明" },
];

const FIELDS_BY_SELF_KIND: Record<"screenItem" | "step" | "column" | "region", FieldDef[]> = {
  screenItem: SCREEN_ITEM_FIELDS,
  step: STEP_FIELDS,
  column: COLUMN_FIELDS,
  region: REGION_FIELDS,
};

export const selfResolver: Resolver = {
  id: "self",

  match(value: string, cursorPos: number, ctx: CompletionContext): CompletionState | null {
    const selfRef = ctx.currentSelfRef;
    if (!selfRef) return null;

    const before = value.slice(0, cursorPos);
    const m = before.match(/@self\.([\w-]*)$/);
    if (!m) return null;

    const prefix = m[1];
    const fields = selfRef.fields ?? FIELDS_BY_SELF_KIND[selfRef.kind] ?? [];
    const candidates = fields
      .filter((f) => f.name.startsWith(prefix))
      .map((f) => {
        const label = "label" in f && f.label ? f.label : f.name;
        return {
          value: f.name,
          label,
          hint: "hint" in f ? f.hint : undefined,
        };
      });

    return {
      phase: "active",
      resolverId: "self",
      prefix,
      candidates,
      replaceLen: prefix.length,
    };
  },
};
