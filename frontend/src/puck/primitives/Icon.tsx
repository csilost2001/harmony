/**
 * Icon primitive — アイコン (Bootstrap Icons / Tailwind 用テキスト emoji 等)。
 *
 * Bootstrap Icons (bi bi-*) を使用。Tailwind モードでも Bootstrap Icons CSS を
 * 参照できれば同様に動く。アイコン名は文字列フリー入力。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface IconProps extends LayoutProps {
  /** Bootstrap Icons のアイコン名 (例: "house", "person", "gear") */
  iconName?: string;
  /** フォントサイズ */
  size?: "sm" | "md" | "lg" | "xl";
}

const ICON_SIZE_BOOTSTRAP: Record<string, string> = {
  sm: "fs-6",
  md: "fs-4",
  lg: "fs-2",
  xl: "fs-1",
};

const ICON_SIZE_TAILWIND: Record<string, string> = {
  sm: "text-base",
  md: "text-2xl",
  lg: "text-4xl",
  xl: "text-6xl",
};

export const IconConfig: ComponentConfig<IconProps> = {
  label: "アイコン",
  fields: {
    iconName: { type: "text", label: "アイコン名 (Bootstrap Icons)" },
    size: {
      type: "select",
      label: "サイズ",
      options: [
        { label: "小 (sm)", value: "sm" },
        { label: "中 (md)", value: "md" },
        { label: "大 (lg)", value: "lg" },
        { label: "特大 (xl)", value: "xl" },
      ],
    },
  },
  defaultProps: { iconName: "star", size: "md" },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const size = props.size ?? "md";
    const sizeClass = framework === "bootstrap"
      ? (ICON_SIZE_BOOTSTRAP[size] ?? "fs-4")
      : (ICON_SIZE_TAILWIND[size] ?? "text-2xl");
    return (
      <span
        data-testid="puck-primitive-icon"
        className={[`bi bi-${props.iconName ?? "star"}`, sizeClass, layoutClass].filter(Boolean).join(" ")}
        aria-hidden="true"
      />
    );
  },
};
