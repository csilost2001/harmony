/**
 * RegionHeader primitive — ヘッダ region 用 Puck コンポーネント。
 *
 * PageLayout composition preview で header region を視覚化する。
 * assignments で header region に gadget が割り当てられている場合は
 * gadget の概要 (screenId + 「Designer で開く」誘導) を表示する。
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
export interface RegionHeaderProps extends LayoutProps {}

export const RegionHeaderConfig: ComponentConfig<RegionHeaderProps> = {
  label: "ヘッダ region",
  fields: {},
  defaultProps: {},
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const assignments = usePageLayoutAssignments();
    const gadgetScreenId = assignments["header"];
    const gadgetData = useGadgetPuckData(gadgetScreenId);
    const puckConfig = usePuckConfig();
    // RFC #1021 pl-6 (Codex H-2): puckConfig + gadgetData が揃えば nested Render を試行
    const canNestedRender = !!(gadgetData && puckConfig);

    return (
      <div
        data-region-name="header"
        data-testid="puck-primitive-region-header"
        className={layoutClass}
        style={{
          border: "2px dashed #a78bfa",
          background: "#ede9fe",
          padding: 12,
          minHeight: 56,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#7c3aed",
            letterSpacing: "0.05em",
            marginBottom: 4,
            textTransform: "uppercase",
          }}
        >
          region: header
        </div>
        {gadgetScreenId ? (
          canNestedRender ? (
            <div style={{ pointerEvents: "none", userSelect: "none" }} data-pl-gadget-render="true">
              <Render config={puckConfig!} data={gadgetData as Data} />
            </div>
          ) : (
            <div style={{ fontSize: 12, color: "#5b21b6" }}>
              {gadgetData ? (
                <span>
                  <i className="bi bi-check-circle-fill" style={{ color: "#7c3aed", marginRight: 4 }} />
                  gadget: <code style={{ fontSize: 11, background: "#ddd6fe", padding: "1px 4px", borderRadius: 3 }}>{gadgetScreenId}</code>
                  <span style={{ color: "#94a3b8", marginLeft: 4 }}>(Config 未注入)</span>
                </span>
              ) : (
                <span style={{ color: "#8b5cf6" }}>
                  gadget: <code style={{ fontSize: 11 }}>{gadgetScreenId}</code>
                  <span style={{ color: "#94a3b8", marginLeft: 4 }}>(未ロード)</span>
                </span>
              )}
            </div>
          )
        ) : (
          <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>
            未割り当て — ページレイアウト設定から header に gadget を割り当ててください
          </div>
        )}
      </div>
    );
  },
};
