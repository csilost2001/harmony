/**
 * v3 Conventions 型定義 (`schemas/v3/conventions.v3.schema.json` と 1:1 対応)
 *
 * - 標準 14 カテゴリ (msg / regex / limit / scope / currency / tax / auth / role / permission / db / numbering / tx / externalOutcomeDefaults + i18n)
 * - 拡張: `extensionCategories` (extensions.v3 の conventionCategories で追加された業界規約)
 * - `@conv.<category>.<key>` で参照される
 *
 * 参考: schemas/v3/conventions.v3.schema.json
 */

import type { Description, DisplayName, FieldType, SemVer, Timestamp } from "./common";

/** 丸めモード (currency / tax の roundingMode 用)。 */
export type RoundingMode = "floor" | "ceil" | "round";

/** I18n 設定。 */
export interface I18nConfig {
  /** BCP 47 locale (例: 'ja-JP', 'en-US') の配列。 */
  supportedLocales: string[];
  defaultLocale: string;
  /** locale ごとの日付フォーマット。 */
  dateFormat?: Record<string, string>;
  /** locale ごとの時刻フォーマット。 */
  timeFormat?: Record<string, string>;
  /** locale ごとの通貨表示モード。 */
  currencyDisplay?: Record<string, "symbol" | "code" | "name">;
  /** locale ごとの数値の桁区切り表示。 */
  numberGrouping?: Record<string, boolean>;
}

/** メッセージテンプレート 1 件 (`@conv.msg.<key>`)。`{placeholder}` 記法。 */
export interface MessageTemplate {
  /** `{placeholder}` 記法のテンプレート文字列。 */
  template: string;
  /** プレースホルダ名一覧 (例: `["label", "max"]`)。 */
  params?: string[];
  /** locale 別の文言上書き (locale → テンプレート文字列)。 */
  locales?: Record<string, string>;
  description?: Description;
}

/** 正規表現 1 件 (`@conv.regex.<key>`)。 */
export interface RegexEntry {
  /** ECMAScript 互換正規表現 (スラッシュ囲みなし)。 */
  pattern: string;
  flags?: string;
  description?: Description;
  /** 正規表現にマッチする例。 */
  exampleValid?: string[];
  /** 正規表現にマッチしない例。 */
  exampleInvalid?: string[];
}

/** 境界値 1 件 (`@conv.limit.<key>`)。`unit='integer'` のとき value は整数値必須 (schema if/then で強制)。 */
export interface LimitEntry {
  value: number;
  /** 単位 (char / integer / yen / ms / days 等)。 */
  unit?: string;
  description?: Description;
}

/** ambient default 機構を持つエントリの共通フィールド (scope / currency / tax / auth / db で利用)。 */
export interface DefaultableEntry {
  /** true でこのエントリが project-wide ambient default。同カテゴリ内で複数 default は未定義動作。 */
  default?: boolean;
}

/** 業務スコープ 1 件 (`@conv.scope.<key>`)。 */
export interface ScopeEntry extends DefaultableEntry {
  value: string;
  description?: Description;
}

/** 通貨 1 件 (`@conv.currency.<key>`)。 */
export interface CurrencyEntry extends DefaultableEntry {
  /** ISO 4217 通貨コード (例: 'JPY', 'USD')。 */
  code: string;
  /**
   * 小数点以下桁数。
   * schema 上は integer 制約 (`{ type: "integer", minimum: 0 }`)。
   * TypeScript には integer 専用型がないため `number` で受ける。
   * 値は UI 側 (`<input type="number" min={0}>`) と AJV で整数強制される前提。
   */
  subunit?: number;
  roundingMode?: RoundingMode;
  description?: Description;
}

/** 税率 1 件 (`@conv.tax.<key>`)。 */
export interface TaxEntry extends DefaultableEntry {
  kind: "inclusive" | "exclusive";
  /** 税率 (0〜1)。 */
  rate: number;
  roundingMode?: RoundingMode;
  description?: Description;
}

/** 認証方式 1 件 (`@conv.auth.<key>`)。 */
export interface AuthEntry extends DefaultableEntry {
  /** 認証方式 (session-cookie / bearer-jwt / basic 等)。 */
  scheme: string;
  sessionStorage?: string;
  passwordHash?: string;
  description?: Description;
}

/** 役割 1 件 (`@conv.role.<key>`)。 */
export interface RoleEntry {
  name?: DisplayName;
  description?: Description;
  /** `@conv.permission.<key>` で参照されるキーの配列。 */
  permissions: string[];
  /** 継承元 role キーの配列 (循環参照は conventionsValidator が検出)。 */
  inherits?: string[];
}

/** 権限 1 件 (`@conv.permission.<key>`)。 */
export interface PermissionEntry {
  resource: string;
  action: string;
  scope?: "all" | "own" | "department";
  description?: Description;
}

/** DB 規約 1 件 (`@conv.db.<key>`)。 */
export interface DbEntry extends DefaultableEntry {
  /** 例: 'postgresql@14', 'oracle@19c'。 */
  engine?: string;
  /** 例: 'snake_case', 'camelCase'。 */
  namingConvention?: string;
  /** タイムスタンプとして扱うカラム名一覧 (例: ['created_at', 'updated_at'])。 */
  timestampColumns?: string[];
  /** 論理削除フラグカラム名 (例: 'is_deleted')。 */
  logicalDeleteColumn?: string;
  description?: Description;
}

/** 採番規約 1 件 (`@conv.numbering.<key>`)。Sequence の conventionRef から参照される。 */
export interface NumberingEntry {
  /** 採番フォーマット (例: 'C-NNNN', 'ORD-YYYY-NNNN')。 */
  format: string;
  /** 実装方式 (例: 'PG sequence + DEFAULT')。 */
  implementation?: string;
  description?: Description;
}

/** TX 方針 1 件 (`@conv.tx.<key>`)。 */
export interface TxEntry {
  policy: string;
  description?: Description;
}

/** 外部連携 outcome 規約 1 件 (`@conv.externalOutcomeDefaults.<key>`)。 */
export interface ExternalOutcomeEntry {
  outcome: "success" | "failure" | "timeout";
  action: "continue" | "abort" | "compensate";
  retry?: "none" | "fixed" | "exponential";
  description?: Description;
}

/**
 * 画面横断 論理フィールド カタログ 1 件 (#651)。
 *
 * `ScreenItem.refKey` が参照する中央集約定義。
 * validation rules (pattern / minLength 等) は意図的に含めない
 * (画面ごとに UI 制約は変えてよい — 業務一貫性は validator で担保し schema で強制しない)。
 */
export interface FieldKeyEntry {
  /** 標準型宣言 (任意)。各 ScreenItem.type と一致しなければ validator が DECLARED_TYPE_MISMATCH (warning)。 */
  type?: FieldType;
  /** 論理フィールドの表示名 (UI ハイライト用)。 */
  displayName?: DisplayName;
  description?: Description;
}

/** Conventions root。`data/conventions/catalog.json` に対応。 */
export interface Conventions {
  $schema?: string;
  version: SemVer;
  description?: Description;
  updatedAt?: Timestamp;
  i18n?: I18nConfig;
  msg?: Record<string, MessageTemplate>;
  regex?: Record<string, RegexEntry>;
  limit?: Record<string, LimitEntry>;
  scope?: Record<string, ScopeEntry>;
  currency?: Record<string, CurrencyEntry>;
  tax?: Record<string, TaxEntry>;
  auth?: Record<string, AuthEntry>;
  role?: Record<string, RoleEntry>;
  permission?: Record<string, PermissionEntry>;
  db?: Record<string, DbEntry>;
  numbering?: Record<string, NumberingEntry>;
  tx?: Record<string, TxEntry>;
  externalOutcomeDefaults?: Record<string, ExternalOutcomeEntry>;
  /**
   * 拡張カテゴリ (extensions.v3 の conventionCategories で定義された業界規約)。
   * `@conv.<categoryName>.<key>` で参照。エントリの shape は拡張側で定義。
   */
  extensionCategories?: Record<string, Record<string, unknown>>;
  /**
   * 画面横断 論理フィールド カタログ (#651)。
   * `ScreenItem.refKey` が参照する中央集約定義。@conv の参照式ではなく純粋な ID レジストリ。
   * 同一 refKey を複数画面で再利用する場合の論理同一性ガバナンスを担う。
   */
  fieldKeys?: Record<string, FieldKeyEntry>;
}
