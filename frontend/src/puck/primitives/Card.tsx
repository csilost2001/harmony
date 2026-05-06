/**
 * Card primitive — カード (業務複合、DropZone 対応)。
 *
 * タイトル + コンテンツ領域 + オプションフッターを持つ。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { DropZone } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface CardProps extends LayoutProps {
  title?: string;
  subtitle?: string;
  /** フッターテキスト (空なら非表示) */
  footer?: string;
}

export const CardConfig: ComponentConfig<CardProps> = {
  label: "カード",
  fields: {
    title: { type: "text", label: "タイトル" },
    subtitle: { type: "text", label: "サブタイトル" },
    footer: { type: "text", label: "フッター (空で非表示)" },
  },
  defaultProps: { title: "カードタイトル", subtitle: "", footer: "" },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);

    if (framework === "bootstrap") {
      return (
        <div data-testid="puck-primitive-card" className={["card", layoutClass].filter(Boolean).join(" ")}>
          <div className="card-body">
            {props.title && <h5 className="card-title">{props.title}</h5>}
            {props.subtitle && <h6 className="card-subtitle mb-2 text-muted">{props.subtitle}</h6>}
            <DropZone zone="content" />
          </div>
          {props.footer && <div className="card-footer text-muted small">{props.footer}</div>}
        </div>
      );
    }
    return (
      <div data-testid="puck-primitive-card" className={["bg-white border border-gray-200 rounded-lg shadow-sm", layoutClass].filter(Boolean).join(" ")}>
        <div className="p-4">
          {props.title && <h3 className="text-lg font-semibold mb-1">{props.title}</h3>}
          {props.subtitle && <p className="text-sm text-gray-500 mb-3">{props.subtitle}</p>}
          <DropZone zone="content" />
        </div>
        {props.footer && (
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-sm text-gray-500">
            {props.footer}
          </div>
        )}
      </div>
    );
  },
};
