/**
 * 共通レイアウト props 型定義。
 *
 * 全 Puck primitive component が組み込みで持つベース props。
 * 永続化層 (Puck Data) は cssFramework 非依存の semantic 値を保持し、
 * 出力層 (CSS class) はマッピング関数によって framework 別 utility class に変換する。
 *
 * 詳細仕様: docs/spec/multi-editor-puck.md § 2.6
 *
 * #806 子 4
 */

export type AlignValue = "left" | "center" | "right";
export type SpacingValue = "none" | "sm" | "md" | "lg" | "xl";
export type GapValue = "none" | "sm" | "md" | "lg";
export type ColorAccentValue =
  | "default"
  | "primary"
  | "secondary"
  | "muted"
  | "success"
  | "warning"
  | "danger";
export type BgAccentValue =
  | "none"
  | "white"
  | "muted"
  | "primary-soft"
  | "success-soft"
  | "warning-soft"
  | "danger-soft";
export type BorderValue = "none" | "default" | "strong";
export type RoundedValue = "none" | "sm" | "md" | "lg" | "full";
export type ShadowValue = "none" | "sm" | "md" | "lg";

/**
 * 共通レイアウト props — 全 Puck primitive が持つベース props。
 *
 * 各フィールドは optional なので、未指定時はマッピング関数が何も出力しない。
 */
export interface LayoutProps {
  align?: AlignValue;
  padding?: SpacingValue;
  paddingX?: SpacingValue;
  paddingY?: SpacingValue;
  margin?: SpacingValue;
  marginBottom?: SpacingValue;
  marginTop?: SpacingValue;
  gap?: GapValue;
  colorAccent?: ColorAccentValue;
  bgAccent?: BgAccentValue;
  border?: BorderValue;
  rounded?: RoundedValue;
  shadow?: ShadowValue;
  /**
   * escape hatch — utility class 直書き (最後の手段、原則使わせない)。
   * Puck UI 上では隠し扱い推奨。dogfood で利用ゼロを目指す。
   */
  rawClass?: string;
}

export type CssFramework = "bootstrap" | "tailwind";

/**
 * マッピング関数: LayoutProps → space-separated class string。
 * 純粋関数・同期・副作用なし。
 */
export type LayoutPropsMapper = (props: LayoutProps) => string;
