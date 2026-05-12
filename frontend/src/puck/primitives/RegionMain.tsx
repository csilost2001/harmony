/**
 * RegionMain primitive — メインコンテンツ region 用 Puck コンポーネント。
 *
 * PageLayout composition preview で main region (content slot) を視覚化する。
 * main region は page Screen 本文が実行時に嵌まるスロットであり、
 * gadget assignment は想定しない。プレースホルダとして「page Screen 本文が嵌まる」を表示する。
 *
 * pl-5 follow-up (#1026): Puck composition preview (feature parity)
 */

import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RegionMainProps extends LayoutProps {}

export const RegionMainConfig: ComponentConfig<RegionMainProps> = {
  label: "メイン region (content slot)",
  fields: {},
  defaultProps: {},
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);

    return (
      <div
        data-region-name="main"
        data-testid="puck-primitive-region-main"
        className={layoutClass}
        style={{
          border: "2px dashed #93c5fd",
          background: "#eff6ff",
          padding: 24,
          minHeight: 200,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#1d4ed8",
            letterSpacing: "0.05em",
            marginBottom: 8,
            textTransform: "uppercase",
          }}
        >
          region: main (content slot)
        </div>
        <div style={{ fontSize: 13, color: "#2563eb" }}>
          <i className="bi bi-layout-text-window-reverse" style={{ fontSize: 24, display: "block", marginBottom: 8, color: "#3b82f6" }} />
          page Screen 本文がここに嵌まります
        </div>
        <div style={{ fontSize: 11, color: "#93c5fd", marginTop: 8 }}>
          runtime 時に各 page Screen のコンテンツがこの slot に配置されます
        </div>
      </div>
    );
  },
};
