/**
 * RegionFooter primitive — フッタ region 用 Puck コンポーネント。
 *
 * PageLayout composition preview で footer region を視覚化する。
 * assignments で footer region に gadget が割り当てられている場合は
 * gadget の概要 (screenId) を表示する。
 * 未割り当ての場合は dashed border のプレースホルダを表示する。
 *
 * pl-5 follow-up (#1026): Puck composition preview (feature parity)
 */

import type { ComponentConfig, Data } from "@measured/puck";
import { Render } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";
import { usePageLayoutAssignments, useGadgetPuckData, usePuckConfig } from "./RegionContext";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RegionFooterProps extends LayoutProps {}

export const RegionFooterConfig: ComponentConfig<RegionFooterProps> = {
  label: "フッタ region",
  fields: {},
  defaultProps: {},
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const assignments = usePageLayoutAssignments();
    const gadgetScreenId = assignments["footer"];
    const gadgetData = useGadgetPuckData(gadgetScreenId);
    const puckConfig = usePuckConfig();
    const canNestedRender = !!(gadgetData && puckConfig);

    return (
      <div
        data-region-name="footer"
        data-testid="puck-primitive-region-footer"
        className={layoutClass}
        style={{
          border: "2px dashed #fb923c",
          background: "#fff7ed",
          padding: 12,
          minHeight: 48,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#c2410c",
            letterSpacing: "0.05em",
            marginBottom: 4,
            textTransform: "uppercase",
          }}
        >
          region: footer
        </div>
        {gadgetScreenId ? (
          canNestedRender ? (
            <div style={{ pointerEvents: "none", userSelect: "none" }} data-pl-gadget-render="true">
              <Render config={puckConfig!} data={gadgetData as Data} />
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#9a3412" }}>
              {gadgetData ? (
                <span>
                  <i className="bi bi-check-circle-fill" style={{ color: "#ea580c", marginRight: 4 }} />
                  gadget: <code style={{ fontSize: 11, background: "#fed7aa", padding: "1px 4px", borderRadius: 3 }}>{gadgetScreenId}</code>
                  <span style={{ color: "#94a3b8", marginLeft: 4 }}>(Config 未注入)</span>
                </span>
              ) : (
                <span style={{ color: "#f97316" }}>
                  gadget: <code style={{ fontSize: 11 }}>{gadgetScreenId}</code>
                  <span style={{ color: "#94a3b8", marginLeft: 4 }}>(未ロード)</span>
                </span>
              )}
            </div>
          )
        ) : (
          <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>
            未割り当て — ページレイアウト設定から footer に gadget を割り当ててください
          </div>
        )}
      </div>
    );
  },
};
