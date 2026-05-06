/**
 * tableConstants.ts (v3, #556)
 * テーブル定義 UI で使うラベル / テンプレート / カテゴリ等の定数。
 * 旧 frontend/src/types/table.ts の UI 関連 export をここに移動。
 */
import type { Column, BuiltinDataType, PhysicalName, DisplayName, LocalId } from "../../types/v3";

/** データ型ラベル (UI dropdown / display 用)。 */
export const DATA_TYPE_LABELS: Record<BuiltinDataType, string> = {
  VARCHAR: "VARCHAR（可変長文字列）",
  CHAR: "CHAR（固定長文字列）",
  TEXT: "TEXT（長文テキスト）",
  INTEGER: "INTEGER（整数）",
  BIGINT: "BIGINT（長整数）",
  SMALLINT: "SMALLINT（短整数）",
  DECIMAL: "DECIMAL（固定小数点）",
  FLOAT: "FLOAT（浮動小数点）",
  BOOLEAN: "BOOLEAN（真偽値）",
  DATE: "DATE（日付）",
  TIME: "TIME（時刻）",
  TIMESTAMP: "TIMESTAMP（日時）",
  BLOB: "BLOB（バイナリ）",
  JSON: "JSON",
};

/** データ型のデフォルト長 (UI 入力補助)。 */
export const DATA_TYPE_DEFAULT_LENGTH: Partial<Record<BuiltinDataType, number>> = {
  VARCHAR: 255,
  CHAR: 1,
  DECIMAL: 10,
};

/** データ型のデフォルトスケール。 */
export const DATA_TYPE_DEFAULT_SCALE: Partial<Record<BuiltinDataType, number>> = {
  DECIMAL: 2,
};

/** 長さ指定が有効なデータ型。 */
export const DATA_TYPES_WITH_LENGTH: BuiltinDataType[] = [
  "VARCHAR", "CHAR", "DECIMAL", "FLOAT",
];

/** スケール指定が有効なデータ型。 */
export const DATA_TYPES_WITH_SCALE: BuiltinDataType[] = ["DECIMAL"];

/** テーブルカテゴリ。 */
export const TABLE_CATEGORIES = [
  "マスタ",
  "トランザクション",
  "中間テーブル",
  "ログ",
  "設定",
  "その他",
] as const;

/** カラムテンプレート (UI から「追加」する際の定型パターン)。 */
export interface ColumnTemplate {
  id: string;
  label: string;
  icon: string;
  category: string;
  /** id / no はテンプレートには含めない (挿入時に採番・生成)。 */
  column: Omit<Column, "id" | "no">;
}

const phys = (s: string) => s as PhysicalName;
const disp = (s: string) => s as DisplayName;

export const COLUMN_TEMPLATES: ColumnTemplate[] = [
  // ── ID・キー系 ──
  {
    id: "tpl-pk-auto",
    label: "ID（自動採番）",
    icon: "bi-key-fill",
    category: "ID・キー",
    column: {
      physicalName: phys("id"),
      name: disp("ID"),
      dataType: "INTEGER",
      notNull: true,
      primaryKey: true,
      unique: false,
      autoIncrement: true,
    },
  },
  {
    id: "tpl-pk-bigint",
    label: "ID（BIGINT）",
    icon: "bi-key",
    category: "ID・キー",
    column: {
      physicalName: phys("id"),
      name: disp("ID"),
      dataType: "BIGINT",
      notNull: true,
      primaryKey: true,
      unique: false,
      autoIncrement: true,
    },
  },
  {
    id: "tpl-fk",
    label: "外部キー（FK）",
    icon: "bi-link-45deg",
    category: "ID・キー",
    column: {
      physicalName: phys("_id"),
      name: disp("参照ID"),
      dataType: "INTEGER",
      notNull: true,
      primaryKey: false,
      unique: false,
    },
  },
  // ── 文字列系 ──
  {
    id: "tpl-name",
    label: "名前",
    icon: "bi-person",
    category: "文字列",
    column: {
      physicalName: phys("name"),
      name: disp("名前"),
      dataType: "VARCHAR",
      length: 100,
      notNull: true,
      primaryKey: false,
      unique: false,
    },
  },
  {
    id: "tpl-email",
    label: "メールアドレス",
    icon: "bi-envelope",
    category: "文字列",
    column: {
      physicalName: phys("email"),
      name: disp("メールアドレス"),
      dataType: "VARCHAR",
      length: 255,
      notNull: false,
      primaryKey: false,
      unique: true,
    },
  },
  {
    id: "tpl-phone",
    label: "電話番号",
    icon: "bi-telephone",
    category: "文字列",
    column: {
      physicalName: phys("phone"),
      name: disp("電話番号"),
      dataType: "VARCHAR",
      length: 20,
      notNull: false,
      primaryKey: false,
      unique: false,
    },
  },
  {
    id: "tpl-address",
    label: "住所",
    icon: "bi-geo-alt",
    category: "文字列",
    column: {
      physicalName: phys("address"),
      name: disp("住所"),
      dataType: "VARCHAR",
      length: 500,
      notNull: false,
      primaryKey: false,
      unique: false,
    },
  },
  {
    id: "tpl-code",
    label: "コード",
    icon: "bi-upc",
    category: "文字列",
    column: {
      physicalName: phys("code"),
      name: disp("コード"),
      dataType: "VARCHAR",
      length: 50,
      notNull: true,
      primaryKey: false,
      unique: true,
    },
  },
  {
    id: "tpl-description",
    label: "説明・備考",
    icon: "bi-card-text",
    category: "文字列",
    column: {
      physicalName: phys("description"),
      name: disp("説明"),
      dataType: "TEXT",
      notNull: false,
      primaryKey: false,
      unique: false,
    },
  },
  {
    id: "tpl-password",
    label: "パスワードハッシュ",
    icon: "bi-shield-lock",
    category: "文字列",
    column: {
      physicalName: phys("password_hash"),
      name: disp("パスワードハッシュ"),
      dataType: "VARCHAR",
      length: 255,
      notNull: true,
      primaryKey: false,
      unique: false,
    },
  },
  // ── 数値系 ──
  {
    id: "tpl-amount",
    label: "金額",
    icon: "bi-currency-yen",
    category: "数値",
    column: {
      physicalName: phys("amount"),
      name: disp("金額"),
      dataType: "DECIMAL",
      length: 12,
      scale: 2,
      notNull: true,
      primaryKey: false,
      unique: false,
      defaultValue: "0",
    },
  },
  {
    id: "tpl-quantity",
    label: "数量",
    icon: "bi-123",
    category: "数値",
    column: {
      physicalName: phys("quantity"),
      name: disp("数量"),
      dataType: "INTEGER",
      notNull: true,
      primaryKey: false,
      unique: false,
      defaultValue: "0",
    },
  },
  {
    id: "tpl-sort-order",
    label: "表示順",
    icon: "bi-sort-numeric-down",
    category: "数値",
    column: {
      physicalName: phys("sort_order"),
      name: disp("表示順"),
      dataType: "INTEGER",
      notNull: true,
      primaryKey: false,
      unique: false,
      defaultValue: "0",
    },
  },
  // ── 日付・フラグ系 ──
  {
    id: "tpl-flag",
    label: "フラグ（有効/無効）",
    icon: "bi-toggle-on",
    category: "フラグ・日付",
    column: {
      physicalName: phys("is_active"),
      name: disp("有効フラグ"),
      dataType: "BOOLEAN",
      notNull: true,
      primaryKey: false,
      unique: false,
      defaultValue: "true",
    },
  },
  {
    id: "tpl-delete-flag",
    label: "削除フラグ",
    icon: "bi-trash",
    category: "フラグ・日付",
    column: {
      physicalName: phys("is_deleted"),
      name: disp("削除フラグ"),
      dataType: "BOOLEAN",
      notNull: true,
      primaryKey: false,
      unique: false,
      defaultValue: "false",
    },
  },
  {
    id: "tpl-status",
    label: "ステータス",
    icon: "bi-flag",
    category: "フラグ・日付",
    column: {
      physicalName: phys("status"),
      name: disp("ステータス"),
      dataType: "VARCHAR",
      length: 20,
      notNull: true,
      primaryKey: false,
      unique: false,
      defaultValue: "'active'",
    },
  },
  {
    id: "tpl-created-at",
    label: "作成日時",
    icon: "bi-clock",
    category: "フラグ・日付",
    column: {
      physicalName: phys("created_at"),
      name: disp("作成日時"),
      dataType: "TIMESTAMP",
      notNull: true,
      primaryKey: false,
      unique: false,
      defaultValue: "CURRENT_TIMESTAMP",
    },
  },
  {
    id: "tpl-updated-at",
    label: "更新日時",
    icon: "bi-clock-history",
    category: "フラグ・日付",
    column: {
      physicalName: phys("updated_at"),
      name: disp("更新日時"),
      dataType: "TIMESTAMP",
      notNull: true,
      primaryKey: false,
      unique: false,
      defaultValue: "CURRENT_TIMESTAMP",
    },
  },
];

// LocalId is re-exported here for convenience in template consumers
export type { LocalId };
