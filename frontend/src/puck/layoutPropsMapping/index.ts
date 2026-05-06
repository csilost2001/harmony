/**
 * layoutPropsMapping — CSS フレームワーク別レイアウト props マッパー。
 *
 * 詳細仕様: docs/spec/multi-editor-puck.md § 5
 *
 * #806 子 4
 */

export type {
  AlignValue,
  SpacingValue,
  GapValue,
  ColorAccentValue,
  BgAccentValue,
  BorderValue,
  RoundedValue,
  ShadowValue,
  LayoutProps,
  CssFramework,
  LayoutPropsMapper,
} from "./types";

export { tailwindMapper } from "./tailwind";
export { bootstrapMapper } from "./bootstrap";

import type { CssFramework, LayoutPropsMapper } from "./types";
import { tailwindMapper } from "./tailwind";
import { bootstrapMapper } from "./bootstrap";

/**
 * cssFramework に応じた LayoutPropsMapper を返す。
 * Puck primitive の render 内で呼び出すことで、framework 別 class 名を得る。
 */
export function resolveLayoutPropsMapper(framework: CssFramework): LayoutPropsMapper {
  return framework === "tailwind" ? tailwindMapper : bootstrapMapper;
}
