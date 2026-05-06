/**
 * buildConfig.ts — 全 Puck primitive を組み合わせた Puck Config を構築する。
 *
 * 共通レイアウト props の fields (LAYOUT_FIELDS) を全 primitive にマージして返す。
 * これにより各 primitive ファイルに共通レイアウト props の field 定義を重複させない。
 *
 * 詳細仕様: docs/spec/multi-editor-puck.md § 4.1 / § 4.3
 *
 * #806 子 4
 */

import type { Config, Fields } from "@measured/puck";

import { ContainerConfig } from "./primitives/Container";
import { RowConfig } from "./primitives/Row";
import { ColConfig } from "./primitives/Col";
import { SectionConfig } from "./primitives/Section";
import { HeadingConfig } from "./primitives/Heading";
import { ParagraphConfig } from "./primitives/Paragraph";
import { LinkConfig } from "./primitives/Link";
import { InputConfig } from "./primitives/Input";
import { SelectConfig } from "./primitives/Select";
import { TextareaConfig } from "./primitives/Textarea";
import { CheckboxConfig } from "./primitives/Checkbox";
import { RadioConfig } from "./primitives/Radio";
import { ButtonConfig } from "./primitives/Button";
import { TableConfig } from "./primitives/Table";
import { ImageConfig } from "./primitives/Image";
import { IconConfig } from "./primitives/Icon";
import { InputGroupConfig } from "./primitives/InputGroup";
import { CardConfig } from "./primitives/Card";
import { DataListConfig } from "./primitives/DataList";
import { PaginationConfig } from "./primitives/Pagination";

// ---------------------------------------------------------------------------
// 共通レイアウト props の Fields 定義
// 全 primitive にマージして Puck プロパティパネルに表示する。
// ---------------------------------------------------------------------------

const ALIGN_OPTIONS = [
  { label: "左", value: "left" },
  { label: "中央", value: "center" },
  { label: "右", value: "right" },
];

const SPACING_OPTIONS = [
  { label: "なし", value: "none" },
  { label: "小 (sm)", value: "sm" },
  { label: "中 (md)", value: "md" },
  { label: "大 (lg)", value: "lg" },
  { label: "特大 (xl)", value: "xl" },
];

const GAP_OPTIONS = [
  { label: "なし", value: "none" },
  { label: "小 (sm)", value: "sm" },
  { label: "中 (md)", value: "md" },
  { label: "大 (lg)", value: "lg" },
];

const COLOR_ACCENT_OPTIONS = [
  { label: "デフォルト", value: "default" },
  { label: "プライマリ", value: "primary" },
  { label: "セカンダリ", value: "secondary" },
  { label: "ミュート", value: "muted" },
  { label: "成功", value: "success" },
  { label: "警告", value: "warning" },
  { label: "危険", value: "danger" },
];

const BG_ACCENT_OPTIONS = [
  { label: "なし", value: "none" },
  { label: "白", value: "white" },
  { label: "ミュート", value: "muted" },
  { label: "プライマリ (薄)", value: "primary-soft" },
  { label: "成功 (薄)", value: "success-soft" },
  { label: "警告 (薄)", value: "warning-soft" },
  { label: "危険 (薄)", value: "danger-soft" },
];

const BORDER_OPTIONS = [
  { label: "なし", value: "none" },
  { label: "標準", value: "default" },
  { label: "強調", value: "strong" },
];

const ROUNDED_OPTIONS = [
  { label: "なし", value: "none" },
  { label: "小", value: "sm" },
  { label: "中", value: "md" },
  { label: "大", value: "lg" },
  { label: "全角", value: "full" },
];

const SHADOW_OPTIONS = [
  { label: "なし", value: "none" },
  { label: "小", value: "sm" },
  { label: "中", value: "md" },
  { label: "大", value: "lg" },
];

/**
 * 全 primitive に共通追加するレイアウト props の Puck Fields 定義。
 * escape hatch の rawClass は隠し扱い (custom フィールドは Puck v0.20 では type:"custom" が必要だが、
 * 簡易実装として text 型で提供し、UI 上末尾に配置する)。
 */
export const LAYOUT_FIELDS: Fields<Record<string, unknown>> = {
  align: { type: "select", label: "整列", options: ALIGN_OPTIONS },
  padding: { type: "select", label: "padding (全方向)", options: SPACING_OPTIONS },
  paddingX: { type: "select", label: "paddingX (左右)", options: SPACING_OPTIONS },
  paddingY: { type: "select", label: "paddingY (上下)", options: SPACING_OPTIONS },
  margin: { type: "select", label: "margin (全方向)", options: SPACING_OPTIONS },
  marginBottom: { type: "select", label: "marginBottom", options: SPACING_OPTIONS },
  marginTop: { type: "select", label: "marginTop", options: SPACING_OPTIONS },
  gap: { type: "select", label: "gap (子要素の間隔)", options: GAP_OPTIONS },
  colorAccent: { type: "select", label: "文字色", options: COLOR_ACCENT_OPTIONS },
  bgAccent: { type: "select", label: "背景色", options: BG_ACCENT_OPTIONS },
  border: { type: "select", label: "枠線", options: BORDER_OPTIONS },
  rounded: { type: "select", label: "角丸", options: ROUNDED_OPTIONS },
  shadow: { type: "select", label: "影", options: SHADOW_OPTIONS },
  rawClass: { type: "text", label: "カスタム class (escape hatch)" },
};

// ---------------------------------------------------------------------------
// buildPuckConfig: 全 primitive + 共通レイアウト fields をマージして Config を返す
// ---------------------------------------------------------------------------

/**
 * Puck Config を構築する。
 * 各 primitive の固有 fields に LAYOUT_FIELDS をマージすることで、
 * 全 primitive が共通レイアウト props を Puck プロパティパネルで操作できる。
 */
export function buildPuckConfig(): Config {
  return {
    components: {
      // --- レイアウト ---
      Container: {
        ...ContainerConfig,
        fields: { ...ContainerConfig.fields, ...LAYOUT_FIELDS },
      },
      Row: {
        ...RowConfig,
        fields: { ...RowConfig.fields, ...LAYOUT_FIELDS },
      },
      Col: {
        ...ColConfig,
        fields: { ...ColConfig.fields, ...LAYOUT_FIELDS },
      },
      Section: {
        ...SectionConfig,
        fields: { ...SectionConfig.fields, ...LAYOUT_FIELDS },
      },
      // --- テキスト ---
      Heading: {
        ...HeadingConfig,
        fields: { ...HeadingConfig.fields, ...LAYOUT_FIELDS },
      },
      Paragraph: {
        ...ParagraphConfig,
        fields: { ...ParagraphConfig.fields, ...LAYOUT_FIELDS },
      },
      Link: {
        ...LinkConfig,
        fields: { ...LinkConfig.fields, ...LAYOUT_FIELDS },
      },
      // --- フォーム ---
      Input: {
        ...InputConfig,
        fields: { ...InputConfig.fields, ...LAYOUT_FIELDS },
      },
      Select: {
        ...SelectConfig,
        fields: { ...SelectConfig.fields, ...LAYOUT_FIELDS },
      },
      Textarea: {
        ...TextareaConfig,
        fields: { ...TextareaConfig.fields, ...LAYOUT_FIELDS },
      },
      Checkbox: {
        ...CheckboxConfig,
        fields: { ...CheckboxConfig.fields, ...LAYOUT_FIELDS },
      },
      Radio: {
        ...RadioConfig,
        fields: { ...RadioConfig.fields, ...LAYOUT_FIELDS },
      },
      Button: {
        ...ButtonConfig,
        fields: { ...ButtonConfig.fields, ...LAYOUT_FIELDS },
      },
      // --- データ ---
      Table: {
        ...TableConfig,
        fields: { ...TableConfig.fields, ...LAYOUT_FIELDS },
      },
      Image: {
        ...ImageConfig,
        fields: { ...ImageConfig.fields, ...LAYOUT_FIELDS },
      },
      Icon: {
        ...IconConfig,
        fields: { ...IconConfig.fields, ...LAYOUT_FIELDS },
      },
      // --- 業務複合 ---
      InputGroup: {
        ...InputGroupConfig,
        fields: { ...InputGroupConfig.fields, ...LAYOUT_FIELDS },
      },
      Card: {
        ...CardConfig,
        fields: { ...CardConfig.fields, ...LAYOUT_FIELDS },
      },
      DataList: {
        ...DataListConfig,
        fields: { ...DataListConfig.fields, ...LAYOUT_FIELDS },
      },
      Pagination: {
        ...PaginationConfig,
        fields: { ...PaginationConfig.fields, ...LAYOUT_FIELDS },
      },
    },
  };
}

/** ビルトイン primitive 名一覧 (動的コンポーネント登録 UI で使う) */
export const BUILTIN_PRIMITIVE_NAMES = [
  "container",
  "row",
  "col",
  "section",
  "heading",
  "paragraph",
  "link",
  "input",
  "select",
  "textarea",
  "checkbox",
  "radio",
  "button",
  "table",
  "image",
  "icon",
  "input-group",
  "card",
  "data-list",
  "pagination",
] as const;

export type BuiltinPrimitiveName = (typeof BUILTIN_PRIMITIVE_NAMES)[number];
