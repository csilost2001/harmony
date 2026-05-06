/**
 * Section primitive — セクション区切り (section タグ、DropZone 対応)。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { DropZone } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface SectionProps extends LayoutProps {
  /** セクションの aria-label */
  label?: string;
}

export const SectionConfig: ComponentConfig<SectionProps> = {
  label: "セクション",
  fields: {
    label: { type: "text", label: "aria-label (アクセシビリティ)" },
  },
  defaultProps: { padding: "md" },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    return (
      <section
        data-testid="puck-primitive-section"
        aria-label={props.label || undefined}
        className={layoutClass || undefined}
      >
        <DropZone zone="content" />
      </section>
    );
  },
};
