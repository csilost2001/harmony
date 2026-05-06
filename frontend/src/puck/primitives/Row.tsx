/**
 * Row primitive — 横並びグリッド行 (DropZone 対応)。
 *
 * Bootstrap では row クラス、Tailwind では flex flex-row。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { DropZone } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export type RowProps = LayoutProps;

export const RowConfig: ComponentConfig<RowProps> = {
  label: "行 (Row)",
  fields: {},
  defaultProps: { gap: "sm" },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    // Bootstrap では "row" + gap-* が自然。Tailwind では "flex flex-row"。
    const baseClass = framework === "bootstrap" ? "row" : "flex flex-row flex-wrap";
    const combinedClass = [baseClass, layoutClass].filter(Boolean).join(" ");
    return (
      <div data-testid="puck-primitive-row" className={combinedClass}>
        <DropZone zone="content" />
      </div>
    );
  },
};
