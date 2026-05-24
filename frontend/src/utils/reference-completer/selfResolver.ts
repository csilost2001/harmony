/**
 * @self.<field> 補完 Resolver (#1301 Phase A / #1308 Phase B、designer-time alias)。
 *
 * Phase A (#1301): currentSelfRef.kind === "screenItem" のみ完全動作。
 * Phase B (#1308): 全 kind (screenItem / step / column / region) で field 補完を support。
 *   - 各 kind の default fields table を定義
 *   - currentSelfRef.fields でケース毎に override 可
 *
 * Phase B-3a (#1322) で validator 側に同等の field 一覧を共有するため、field 名は
 * designerAliasFields.ts に集約。本ファイルは UI 用 hint を組み合わせる責務のみ。
 *
 * spec: docs/spec/process-flow-prefix-system.md § 11.2
 */

import type { CompletionContext, CompletionState, Resolver } from "./types";
import {
  SELF_COLUMN_FIELD_NAMES,
  SELF_REGION_FIELD_NAMES,
  SELF_SCREEN_ITEM_FIELD_NAMES,
  SELF_STEP_FIELD_NAMES,
} from "./designerAliasFields";

interface FieldDef {
  name: string;
  hint?: string;
}

const SCREEN_ITEM_FIELD_META: Record<(typeof SELF_SCREEN_ITEM_FIELD_NAMES)[number], Omit<FieldDef, "name">> = {
  id: { hint: "item id (string)" },
  label: { hint: "表示 label (string)" },
  value: { hint: "current value (any)" },
  readonly: { hint: "読取専用フラグ (boolean)" },
  enabled: { hint: "活性フラグ (boolean)" },
  visible: { hint: "表示フラグ (boolean)" },
  errors: { hint: "エラー配列 (string[])" },
  options: { hint: "選択肢 (options 系 item のみ)" },
};

const STEP_FIELD_META: Record<(typeof SELF_STEP_FIELD_NAMES)[number], Omit<FieldDef, "name">> = {
  id: { hint: "step id (LocalId)" },
  description: { hint: "step 説明" },
  runIf: { hint: "実行条件式 (TemplateString)" },
  outputBinding: { hint: "outputBinding object (name / expose / transformations)" },
  compensatesFor: { hint: "Saga 補償対象 step.id" },
};

const COLUMN_FIELD_META: Record<(typeof SELF_COLUMN_FIELD_NAMES)[number], Omit<FieldDef, "name">> = {
  id: { hint: "column id (LocalId)" },
  physicalName: { hint: "DB 物理名 (snake_case)" },
  name: { hint: "表示名" },
  dataType: { hint: "DataType (VARCHAR / INTEGER / etc.)" },
  notNull: { hint: "NOT NULL フラグ" },
  primaryKey: { hint: "PRIMARY KEY フラグ" },
  defaultValue: { hint: "DEFAULT 値 (literal / 式)" },
  comment: { hint: "DDL カラムコメント" },
};

const REGION_FIELD_META: Record<(typeof SELF_REGION_FIELD_NAMES)[number], Omit<FieldDef, "name">> = {
  name: { hint: "region 名 (header / sidebar / footer / main / custom)" },
  description: { hint: "region の用途説明" },
};

function expandFields<T extends readonly string[]>(
  names: T,
  meta: Record<T[number], Omit<FieldDef, "name">>,
): FieldDef[] {
  return names.map((name) => ({ name, ...meta[name as T[number]] }));
}

const SCREEN_ITEM_FIELDS: FieldDef[] = expandFields(SELF_SCREEN_ITEM_FIELD_NAMES, SCREEN_ITEM_FIELD_META);
const STEP_FIELDS: FieldDef[] = expandFields(SELF_STEP_FIELD_NAMES, STEP_FIELD_META);
const COLUMN_FIELDS: FieldDef[] = expandFields(SELF_COLUMN_FIELD_NAMES, COLUMN_FIELD_META);
const REGION_FIELDS: FieldDef[] = expandFields(SELF_REGION_FIELD_NAMES, REGION_FIELD_META);

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
