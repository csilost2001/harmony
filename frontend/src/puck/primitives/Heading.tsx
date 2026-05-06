/**
 * Heading primitive — 見出し (h1-h4)。
 *
 * 共通レイアウト props は buildConfig.ts で LAYOUT_FIELDS がマージされる。
 * render 内では useCssFramework() + resolveLayoutPropsMapper() でクラスを計算する。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface HeadingProps extends LayoutProps {
  text?: string;
  level?: "h1" | "h2" | "h3" | "h4";
}

export const HeadingConfig: ComponentConfig<HeadingProps> = {
  label: "見出し",
  fields: {
    text: { type: "text", label: "テキスト" },
    level: {
      type: "select",
      label: "見出しレベル",
      options: [
        { label: "H1", value: "h1" },
        { label: "H2", value: "h2" },
        { label: "H3", value: "h3" },
        { label: "H4", value: "h4" },
      ],
    },
  },
  defaultProps: { text: "見出し", level: "h2" },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const Tag = props.level ?? "h2";
    return <Tag data-testid="puck-primitive-heading" className={layoutClass || undefined}>{props.text}</Tag>;
  },
};
