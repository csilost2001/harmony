/**
 * Col primitive — グリッド列 (DropZone 対応)。
 *
 * Bootstrap では col-* クラス、Tailwind では flex-1 / w-1/2 等。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { DropZone } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface ColProps extends LayoutProps {
  /** Bootstrap grid 列幅 (1-12)。Tailwind では参考値として使う。 */
  span?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
}

// Tailwind: 完全 class 名で列挙 (JIT 対応)
const TAILWIND_COL: Record<number, string> = {
  1: "w-1/12",
  2: "w-2/12",
  3: "w-3/12",
  4: "w-4/12",
  5: "w-5/12",
  6: "w-6/12",
  7: "w-7/12",
  8: "w-8/12",
  9: "w-9/12",
  10: "w-10/12",
  11: "w-11/12",
  12: "w-full",
};

// Bootstrap: 完全 class 名で列挙
const BOOTSTRAP_COL: Record<number, string> = {
  1: "col-1",
  2: "col-2",
  3: "col-3",
  4: "col-4",
  5: "col-5",
  6: "col-6",
  7: "col-7",
  8: "col-8",
  9: "col-9",
  10: "col-10",
  11: "col-11",
  12: "col-12",
};

export const ColConfig: ComponentConfig<ColProps> = {
  label: "列 (Col)",
  fields: {
    span: {
      type: "select",
      label: "列幅",
      options: [
        { label: "1/12", value: 1 },
        { label: "2/12 (1/6)", value: 2 },
        { label: "3/12 (1/4)", value: 3 },
        { label: "4/12 (1/3)", value: 4 },
        { label: "6/12 (1/2)", value: 6 },
        { label: "8/12 (2/3)", value: 8 },
        { label: "9/12 (3/4)", value: 9 },
        { label: "12/12 (全幅)", value: 12 },
      ],
    },
  },
  defaultProps: { span: 6 },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const span = props.span ?? 6;
    const colClass =
      framework === "bootstrap"
        ? (BOOTSTRAP_COL[span] ?? "col")
        : (TAILWIND_COL[span] ?? "w-6/12");
    const combinedClass = [colClass, layoutClass].filter(Boolean).join(" ");
    return (
      <div data-testid="puck-primitive-col" className={combinedClass}>
        <DropZone zone="content" />
      </div>
    );
  },
};
