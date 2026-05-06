/**
 * DataList primitive — データリスト表示 (業務複合)。
 *
 * 繰り返し行のサンプルプレースホルダーを提供する。
 * 実際のデータは実装時に置き換える前提。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface DataListProps extends LayoutProps {
  title?: string;
  columns?: string;
  sampleRows?: number;
  showActions?: boolean;
}

export const DataListConfig: ComponentConfig<DataListProps> = {
  label: "データリスト",
  fields: {
    title: { type: "text", label: "リストタイトル" },
    columns: { type: "text", label: "列名 (カンマ区切り)" },
    sampleRows: { type: "number", label: "サンプル行数", min: 1, max: 10 },
    showActions: { type: "radio", label: "操作列", options: [
      { label: "表示", value: true },
      { label: "非表示", value: false },
    ] },
  },
  defaultProps: { title: "一覧", columns: "ID,名前,状態", sampleRows: 5, showActions: true },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const cols = (props.columns ?? "ID,名前,状態").split(",").map((c) => c.trim()).filter(Boolean);
    const rows = Array.from({ length: props.sampleRows ?? 5 }, (_, i) => i + 1);

    if (framework === "bootstrap") {
      return (
        <div data-testid="puck-primitive-data-list" className={layoutClass || undefined}>
          {props.title && <h6 className="mb-2 fw-semibold">{props.title}</h6>}
          <div className="table-responsive">
            <table className="table table-hover table-sm">
              <thead className="table-light">
                <tr>
                  {cols.map((c) => <th key={c}>{c}</th>)}
                  {props.showActions && <th>操作</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r}>
                    {cols.map((c) => <td key={c}>{c === "ID" ? r : "-"}</td>)}
                    {props.showActions && (
                      <td>
                        <button className="btn btn-sm btn-outline-primary me-1">編集</button>
                        <button className="btn btn-sm btn-outline-danger">削除</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    return (
      <div data-testid="puck-primitive-data-list" className={layoutClass || undefined}>
        {props.title && <h3 className="text-base font-semibold mb-2">{props.title}</h3>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-100">
                {cols.map((c) => <th key={c} className="px-3 py-2 text-left font-medium border-b border-gray-200">{c}</th>)}
                {props.showActions && <th className="px-3 py-2 text-left font-medium border-b border-gray-200">操作</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r} className="hover:bg-gray-50">
                  {cols.map((c) => <td key={c} className="px-3 py-2 border-b border-gray-100">{c === "ID" ? r : "-"}</td>)}
                  {props.showActions && (
                    <td className="px-3 py-2 border-b border-gray-100">
                      <button className="text-blue-600 hover:underline mr-2 text-xs">編集</button>
                      <button className="text-red-600 hover:underline text-xs">削除</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  },
};
