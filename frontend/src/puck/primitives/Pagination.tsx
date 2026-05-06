/**
 * Pagination primitive — ページネーション (業務複合)。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface PaginationProps extends LayoutProps {
  totalPages?: number;
  currentPage?: number;
  showFirstLast?: boolean;
}

export const PaginationConfig: ComponentConfig<PaginationProps> = {
  label: "ページネーション",
  fields: {
    totalPages: { type: "number", label: "総ページ数", min: 1, max: 100 },
    currentPage: { type: "number", label: "現在のページ", min: 1, max: 100 },
    showFirstLast: { type: "radio", label: "最初/最後ボタン", options: [
      { label: "表示", value: true },
      { label: "非表示", value: false },
    ] },
  },
  defaultProps: { totalPages: 5, currentPage: 1, showFirstLast: true },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const total = props.totalPages ?? 5;
    const current = props.currentPage ?? 1;
    const pages = Array.from({ length: Math.min(total, 7) }, (_, i) => i + 1);

    if (framework === "bootstrap") {
      return (
        <nav data-testid="puck-primitive-pagination" className={layoutClass || undefined} aria-label="ページネーション">
          <ul className="pagination">
            {props.showFirstLast && <li className="page-item disabled"><button className="page-link">«</button></li>}
            <li className="page-item disabled"><button className="page-link">‹</button></li>
            {pages.map((p) => (
              <li key={p} className={`page-item ${p === current ? "active" : ""}`}>
                <button className="page-link">{p}</button>
              </li>
            ))}
            <li className="page-item"><button className="page-link">›</button></li>
            {props.showFirstLast && <li className="page-item"><button className="page-link">»</button></li>}
          </ul>
        </nav>
      );
    }
    return (
      <nav data-testid="puck-primitive-pagination" className={["flex items-center gap-1", layoutClass].filter(Boolean).join(" ")} aria-label="ページネーション">
        {props.showFirstLast && <button className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50">«</button>}
        <button className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50">‹</button>
        {pages.map((p) => (
          <button
            key={p}
            className={`px-3 py-1 text-sm border rounded ${p === current ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 hover:bg-gray-50"}`}
          >
            {p}
          </button>
        ))}
        <button className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50">›</button>
        {props.showFirstLast && <button className="px-2 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50">»</button>}
      </nav>
    );
  },
};
