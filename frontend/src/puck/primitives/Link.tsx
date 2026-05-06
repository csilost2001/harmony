/**
 * Link primitive — リンク (a)。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface LinkProps extends LayoutProps {
  text?: string;
  href?: string;
  target?: "_self" | "_blank";
}

export const LinkConfig: ComponentConfig<LinkProps> = {
  label: "リンク",
  fields: {
    text: { type: "text", label: "リンクテキスト" },
    href: { type: "text", label: "URL" },
    target: {
      type: "select",
      label: "開き方",
      options: [
        { label: "同じウィンドウ", value: "_self" },
        { label: "新しいウィンドウ", value: "_blank" },
      ],
    },
  },
  defaultProps: { text: "リンク", href: "#", target: "_self" },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    return (
      <a
        data-testid="puck-primitive-link"
        href={props.href ?? "#"}
        target={props.target ?? "_self"}
        rel={props.target === "_blank" ? "noopener noreferrer" : undefined}
        className={layoutClass || undefined}
      >
        {props.text}
      </a>
    );
  },
};
