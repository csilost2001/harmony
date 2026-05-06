/**
 * Paragraph primitive — 段落テキスト (p)。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface ParagraphProps extends LayoutProps {
  text?: string;
}

export const ParagraphConfig: ComponentConfig<ParagraphProps> = {
  label: "段落",
  fields: {
    text: { type: "textarea", label: "テキスト" },
  },
  defaultProps: { text: "テキストを入力してください。" },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    return <p data-testid="puck-primitive-paragraph" className={layoutClass || undefined}>{props.text}</p>;
  },
};
