/**
 * Table primitive — データテーブル (table)。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface TableProps extends LayoutProps {
  caption?: string;
  columns?: string;
  /** サンプル行数 (デザイン確認用) */
  sampleRows?: number;
  striped?: boolean;
  bordered?: boolean;
}

export const TableConfig: ComponentConfig<TableProps> = {
  label: "テーブル",
  fields: {
    caption: { type: "text", label: "キャプション" },
    columns: { type: "text", label: "列名 (カンマ区切り)" },
    sampleRows: { type: "number", label: "サンプル行数", min: 1, max: 10 },
    striped: { type: "radio", label: "縞模様", options: [
      { label: "あり", value: true },
      { label: "なし", value: false },
    ] },
    bordered: { type: "radio", label: "罫線", options: [
      { label: "あり", value: true },
      { label: "なし", value: false },
    ] },
  },
  defaultProps: { caption: "", columns: "列 1,列 2,列 3", sampleRows: 3, striped: true, bordered: false },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const cols = (props.columns ?? "列 1,列 2,列 3").split(",").map((c) => c.trim()).filter(Boolean);
    const rows = Array.from({ length: props.sampleRows ?? 3 }, (_, i) => i + 1);

    if (framework === "bootstrap") {
      const tableClass = [
        "table",
        props.striped ? "table-striped" : "",
        props.bordered ? "table-bordered" : "",
      ].filter(Boolean).join(" ");
      return (
        <div data-testid="puck-primitive-table" className={["table-responsive", layoutClass].filter(Boolean).join(" ")}>
          <table className={tableClass}>
            {props.caption && <caption>{props.caption}</caption>}
            <thead className="table-light"><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{rows.map((r) => <tr key={r}>{cols.map((c) => <td key={c}>-</td>)}</tr>)}</tbody>
          </table>
        </div>
      );
    }
    const tableClass = ["w-full border-collapse text-sm", props.bordered ? "border border-gray-300" : ""].filter(Boolean).join(" ");
    return (
      <div data-testid="puck-primitive-table" className={["overflow-x-auto", layoutClass].filter(Boolean).join(" ")}>
        <table className={tableClass}>
          {props.caption && <caption className="text-left text-gray-500 mb-1">{props.caption}</caption>}
          <thead><tr className="bg-gray-100">{cols.map((c) => <th key={c} className="px-4 py-2 text-left font-medium">{c}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={r} className={props.striped && r % 2 === 0 ? "bg-gray-50" : ""}>{cols.map((c) => <td key={c} className="px-4 py-2">-</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  },
};
