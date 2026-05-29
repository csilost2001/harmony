/**
 * Container primitive — 汎用コンテナ div (DropZone 対応)。
 *
 * Puck の DropZone を内包して子コンポーネントを受け取る。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { DropZone } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface ContainerProps extends LayoutProps {
  /** 子要素を並べる方向 */
  direction?: "row" | "column";
}

export const ContainerConfig: ComponentConfig<ContainerProps> = {
  label: "コンテナ",
  fields: {
    direction: {
      type: "select",
      label: "方向",
      options: [
        { label: "縦 (column)", value: "column" },
        { label: "横 (row)", value: "row" },
      ],
    },
  },
  defaultProps: { direction: "column" },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const flexClass = props.direction === "row" ? "flex flex-row" : "flex flex-col";
    const combinedClass = [flexClass, layoutClass].filter(Boolean).join(" ");
    // #1404: Puck の <DropZone> は外側コンテナと子要素の間に自前の wrapper div
    // を挟むため、direction (flex-row / flex-col) を効かせる対象は「子の直接の
    // 親」= DropZone wrapper である。flex class は外側ではなく DropZone の
    // className に渡す (Row と同根)。
    return (
      <div data-testid="puck-primitive-container">
        <DropZone zone="content" className={combinedClass} />
      </div>
    );
  },
};
