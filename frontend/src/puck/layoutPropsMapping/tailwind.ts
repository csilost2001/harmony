/**
 * Tailwind utility マッピング。
 *
 * 仕様書 docs/spec/multi-editor-puck.md § 2.6 の Tailwind 列に従う。
 * Tailwind JIT 対応のため完全 class 名を static に列挙する (§ 11.1)。
 * arbitrary value は不許可 (§ 2.7)。
 *
 * #806 子 4
 */

import type {
  AlignValue,
  SpacingValue,
  GapValue,
  ColorAccentValue,
  BgAccentValue,
  BorderValue,
  RoundedValue,
  ShadowValue,
  LayoutProps,
  LayoutPropsMapper,
} from "./types";

// ---------------------------------------------------------------------------
// マッピングテーブル — 完全 class 名で出力 (Tailwind JIT 静的解析対応)
// ---------------------------------------------------------------------------

const ALIGN: Record<AlignValue, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

const PADDING: Record<SpacingValue, string> = {
  none: "p-0",
  sm: "p-2",
  md: "p-4",
  lg: "p-6",
  xl: "p-8",
};

const PADDING_X: Record<SpacingValue, string> = {
  none: "px-0",
  sm: "px-2",
  md: "px-4",
  lg: "px-6",
  xl: "px-8",
};

const PADDING_Y: Record<SpacingValue, string> = {
  none: "py-0",
  sm: "py-2",
  md: "py-4",
  lg: "py-6",
  xl: "py-8",
};

const MARGIN: Record<SpacingValue, string> = {
  none: "m-0",
  sm: "m-2",
  md: "m-4",
  lg: "m-6",
  xl: "m-8",
};

const MARGIN_BOTTOM: Record<SpacingValue, string> = {
  none: "mb-0",
  sm: "mb-2",
  md: "mb-4",
  lg: "mb-6",
  xl: "mb-8",
};

const MARGIN_TOP: Record<SpacingValue, string> = {
  none: "mt-0",
  sm: "mt-2",
  md: "mt-4",
  lg: "mt-6",
  xl: "mt-8",
};

const GAP: Record<GapValue, string> = {
  none: "gap-0",
  sm: "gap-2",
  md: "gap-4",
  lg: "gap-6",
};

const COLOR_ACCENT: Record<ColorAccentValue, string> = {
  default: "text-gray-900",
  primary: "text-blue-600",
  secondary: "text-purple-600",
  muted: "text-gray-500",
  success: "text-green-600",
  warning: "text-yellow-600",
  danger: "text-red-600",
};

const BG_ACCENT: Record<BgAccentValue, string> = {
  none: "",
  white: "bg-white",
  muted: "bg-gray-50",
  "primary-soft": "bg-blue-50",
  "success-soft": "bg-green-50",
  "warning-soft": "bg-yellow-50",
  "danger-soft": "bg-red-50",
};

const BORDER: Record<BorderValue, string> = {
  none: "",
  default: "border",
  strong: "border-2",
};

const ROUNDED: Record<RoundedValue, string> = {
  none: "rounded-none",
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
};

const SHADOW: Record<ShadowValue, string> = {
  none: "",
  sm: "shadow-sm",
  md: "shadow-md",
  lg: "shadow-lg",
};

// ---------------------------------------------------------------------------
// マッピング関数
// ---------------------------------------------------------------------------

/**
 * Tailwind utility マッパー。
 * LayoutProps → space-separated Tailwind utility class string。
 * 未定義の prop は class を出力しない。空文字値 (none 等) も省く。
 */
export const tailwindMapper: LayoutPropsMapper = (props: LayoutProps): string => {
  const classes: string[] = [];

  if (props.align !== undefined) classes.push(ALIGN[props.align]);
  if (props.padding !== undefined) classes.push(PADDING[props.padding]);
  if (props.paddingX !== undefined) classes.push(PADDING_X[props.paddingX]);
  if (props.paddingY !== undefined) classes.push(PADDING_Y[props.paddingY]);
  if (props.margin !== undefined) classes.push(MARGIN[props.margin]);
  if (props.marginBottom !== undefined) classes.push(MARGIN_BOTTOM[props.marginBottom]);
  if (props.marginTop !== undefined) classes.push(MARGIN_TOP[props.marginTop]);
  if (props.gap !== undefined) classes.push(GAP[props.gap]);
  if (props.colorAccent !== undefined) classes.push(COLOR_ACCENT[props.colorAccent]);
  if (props.bgAccent !== undefined) {
    const cls = BG_ACCENT[props.bgAccent];
    if (cls) classes.push(cls);
  }
  if (props.border !== undefined) {
    const cls = BORDER[props.border];
    if (cls) classes.push(cls);
  }
  if (props.rounded !== undefined) classes.push(ROUNDED[props.rounded]);
  if (props.shadow !== undefined) {
    const cls = SHADOW[props.shadow];
    if (cls) classes.push(cls);
  }
  if (props.rawClass) classes.push(props.rawClass);

  return classes.join(" ");
};

// ---------------------------------------------------------------------------
// JIT safelist 用: このファイルに出現する全完全 class 名の静的一覧
// (tailwind.config.ts の safelist でこのファイルを参照する代わりに、
//  このコメントに列挙することで JIT が検出できる)
// ---------------------------------------------------------------------------
// text-left text-center text-right
// p-0 p-2 p-4 p-6 p-8
// px-0 px-2 px-4 px-6 px-8
// py-0 py-2 py-4 py-6 py-8
// m-0 m-2 m-4 m-6 m-8
// mb-0 mb-2 mb-4 mb-6 mb-8
// mt-0 mt-2 mt-4 mt-6 mt-8
// gap-0 gap-2 gap-4 gap-6
// text-gray-900 text-blue-600 text-purple-600 text-gray-500 text-green-600 text-yellow-600 text-red-600
// bg-white bg-gray-50 bg-blue-50 bg-green-50 bg-yellow-50 bg-red-50
// border border-2
// rounded-none rounded-sm rounded-md rounded-lg rounded-full
// shadow-sm shadow-md shadow-lg
