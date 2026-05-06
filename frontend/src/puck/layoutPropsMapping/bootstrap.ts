/**
 * Bootstrap 5 utility マッピング。
 *
 * 仕様書 docs/spec/multi-editor-puck.md § 2.6 の Bootstrap 列に従う。
 * Bootstrap 5 既製 utility 主体: text-start/center/end, p-0..5, mb-*, gap-*,
 * text-primary 等, bg-light/bg-white/bg-primary-subtle 等, border, rounded-0..3/rounded-pill,
 * shadow-sm/shadow/shadow-lg。
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
// マッピングテーブル — Bootstrap 5 utility class
// ---------------------------------------------------------------------------

const ALIGN: Record<AlignValue, string> = {
  left: "text-start",
  center: "text-center",
  right: "text-end",
};

const PADDING: Record<SpacingValue, string> = {
  none: "p-0",
  sm: "p-2",
  md: "p-3",
  lg: "p-4",
  xl: "p-5",
};

const PADDING_X: Record<SpacingValue, string> = {
  none: "px-0",
  sm: "px-2",
  md: "px-3",
  lg: "px-4",
  xl: "px-5",
};

const PADDING_Y: Record<SpacingValue, string> = {
  none: "py-0",
  sm: "py-2",
  md: "py-3",
  lg: "py-4",
  xl: "py-5",
};

const MARGIN: Record<SpacingValue, string> = {
  none: "m-0",
  sm: "m-2",
  md: "m-3",
  lg: "m-4",
  xl: "m-5",
};

const MARGIN_BOTTOM: Record<SpacingValue, string> = {
  none: "mb-0",
  sm: "mb-2",
  md: "mb-3",
  lg: "mb-4",
  xl: "mb-5",
};

const MARGIN_TOP: Record<SpacingValue, string> = {
  none: "mt-0",
  sm: "mt-2",
  md: "mt-3",
  lg: "mt-4",
  xl: "mt-5",
};

const GAP: Record<GapValue, string> = {
  none: "gap-0",
  sm: "gap-2",
  md: "gap-3",
  lg: "gap-4",
};

const COLOR_ACCENT: Record<ColorAccentValue, string> = {
  default: "",
  primary: "text-primary",
  secondary: "text-secondary",
  muted: "text-muted",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

const BG_ACCENT: Record<BgAccentValue, string> = {
  none: "",
  white: "bg-white",
  muted: "bg-light",
  "primary-soft": "bg-primary-subtle",
  "success-soft": "bg-success-subtle",
  "warning-soft": "bg-warning-subtle",
  "danger-soft": "bg-danger-subtle",
};

const BORDER: Record<BorderValue, string> = {
  none: "",
  default: "border",
  strong: "border border-2",
};

const ROUNDED: Record<RoundedValue, string> = {
  none: "rounded-0",
  sm: "rounded-1",
  md: "rounded-2",
  lg: "rounded-3",
  full: "rounded-pill",
};

const SHADOW: Record<ShadowValue, string> = {
  none: "",
  sm: "shadow-sm",
  md: "shadow",
  lg: "shadow-lg",
};

// ---------------------------------------------------------------------------
// マッピング関数
// ---------------------------------------------------------------------------

/**
 * Bootstrap 5 utility マッパー。
 * LayoutProps → space-separated Bootstrap 5 utility class string。
 * 未定義の prop は class を出力しない。空文字値 (none 等) も省く。
 */
export const bootstrapMapper: LayoutPropsMapper = (props: LayoutProps): string => {
  const classes: string[] = [];

  if (props.align !== undefined) classes.push(ALIGN[props.align]);
  if (props.padding !== undefined) classes.push(PADDING[props.padding]);
  if (props.paddingX !== undefined) classes.push(PADDING_X[props.paddingX]);
  if (props.paddingY !== undefined) classes.push(PADDING_Y[props.paddingY]);
  if (props.margin !== undefined) classes.push(MARGIN[props.margin]);
  if (props.marginBottom !== undefined) classes.push(MARGIN_BOTTOM[props.marginBottom]);
  if (props.marginTop !== undefined) classes.push(MARGIN_TOP[props.marginTop]);
  if (props.gap !== undefined) classes.push(GAP[props.gap]);
  if (props.colorAccent !== undefined) {
    const cls = COLOR_ACCENT[props.colorAccent];
    if (cls) classes.push(cls);
  }
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
