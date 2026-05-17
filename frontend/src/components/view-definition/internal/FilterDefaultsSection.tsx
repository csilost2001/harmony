/**
 * FilterDefaultsSection — Section 5: filterDefaults 編集 (Phase-4 抽出)
 *
 * 初期フィルタを columnName / operator / value / valueExpression で複数指定。
 */
import type { ViewDefinition, FilterSpec, FilterOperator } from "../../../types/v3/view-definition";
import type { Identifier } from "../../../types/v3/common";
import type { ViewDefinitionIssue } from "../../../schemas/viewDefinitionValidator";
import { IssueHints } from "./IssueHints";
import { FILTER_OPERATORS } from "./viewDefinitionConstants";

interface Props {
  viewDefinition: ViewDefinition;
  columnNames: string[];
  isReadonly: boolean;
  addFilterSpec: () => void;
  removeFilterSpec: (fi: number) => void;
  updateFilterSpec: <K extends keyof FilterSpec>(fi: number, field: K, value: FilterSpec[K]) => void;
  updateSilentWithDraft: (fn: (s: ViewDefinition) => void) => void;
  commit: () => void;
  filterPath: (fi: number, field: string) => string;
  getIssues: (path: string) => ViewDefinitionIssue[];
}

export function FilterDefaultsSection({
  viewDefinition,
  columnNames,
  isReadonly,
  addFilterSpec,
  removeFilterSpec,
  updateFilterSpec,
  updateSilentWithDraft,
  commit,
  filterPath,
  getIssues,
}: Props) {
  const specs = viewDefinition.filterDefaults ?? [];
  return (
    <section className="seq-editor-section">
      <h3 className="seq-editor-section-title">
        初期フィルタ
        <span className="vd-editor-col-count">({specs.length} 件)</span>
      </h3>

      {specs.length > 0 && (
        <table className="vd-editor-sub-table">
          <thead>
            <tr>
              <th>カラム名</th>
              <th>演算子</th>
              <th>値</th>
              <th>値 (式)</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {specs.map((spec, fi) => {
              const colIssues = getIssues(filterPath(fi, "columnName"));
              const opIssues = getIssues(filterPath(fi, "operator"));
              return (
                <tr
                  key={fi}
                  className={
                    [...colIssues, ...opIssues].some((i) => i.severity === "error")
                      ? "vd-col-row--error"
                      : [...colIssues, ...opIssues].some((i) => i.severity === "warning")
                        ? "vd-col-row--warning"
                        : undefined
                  }
                >
                  <td>
                    <select
                      value={spec.columnName as string}
                      onChange={(e) => updateFilterSpec(fi, "columnName", e.target.value as Identifier)}
                      className={colIssues.length > 0 ? "input-error" : undefined}
                      disabled={isReadonly}
                    >
                      <option value="">— カラムを選択 —</option>
                      {columnNames.map((cn) => (
                        <option key={cn} value={cn}>{cn}</option>
                      ))}
                    </select>
                    <IssueHints issues={colIssues} />
                  </td>
                  <td>
                    <select
                      value={spec.operator}
                      onChange={(e) => updateFilterSpec(fi, "operator", e.target.value as FilterOperator)}
                      className={opIssues.length > 0 ? "input-error" : undefined}
                      disabled={isReadonly}
                    >
                      {FILTER_OPERATORS.map((op) => (
                        <option key={op} value={op}>{op}</option>
                      ))}
                    </select>
                    <IssueHints issues={opIssues} />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={typeof spec.value === "string" ? spec.value : spec.value != null ? String(spec.value) : ""}
                      onChange={(e) => updateSilentWithDraft((d) => {
                        const arr = d.filterDefaults ?? [];
                        arr[fi] = { ...arr[fi], value: e.target.value || undefined };
                        d.filterDefaults = arr;
                      })}
                      onBlur={() => { if (!isReadonly) commit(); }}
                      placeholder="比較値"
                      className="vd-col-input-sm"
                      disabled={isReadonly}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={spec.valueExpression ?? ""}
                      onChange={(e) => updateSilentWithDraft((d) => {
                        const arr = d.filterDefaults ?? [];
                        arr[fi] = { ...arr[fi], valueExpression: (e.target.value || undefined) as FilterSpec["valueExpression"] };
                        d.filterDefaults = arr;
                      })}
                      onBlur={() => { if (!isReadonly) commit(); }}
                      placeholder="@conv.numbering.threshold"
                      className="vd-col-input-sm"
                      disabled={isReadonly}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="tbl-btn-icon danger"
                      onClick={() => removeFilterSpec(fi)}
                      title="削除"
                      disabled={isReadonly}
                    >
                      <i className="bi bi-trash" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <button
        type="button"
        className="tbl-btn tbl-btn-ghost vd-editor-add-row-btn"
        onClick={addFilterSpec}
        disabled={isReadonly}
      >
        <i className="bi bi-plus-lg" /> フィルタ条件追加
      </button>
    </section>
  );
}
