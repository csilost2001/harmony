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
    // #1404: Puck の <DropZone> は外側コンテナと Col 群の間に自前の wrapper div
    // (data-puck-dropzone) を挟む。横並びの flex/grid context を効かせる対象は
    // 「Col の直接の親」= この DropZone wrapper なので、レイアウト class は外側
    // ではなく DropZone の className に渡す必要がある。外側 div は識別用の
    // 単なるコンテナとして残す (display:block のまま、子の DropZone が 100% 幅)。
    return (
      <div data-testid="puck-primitive-row">
        <DropZone zone="content" className={combinedClass} />
      </div>
    );
  },
};
