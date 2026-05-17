/**
 * SortDefaultsSection — Section 4: sortDefaults 編集 (Phase-4 抽出)
 *
 * 既定ソート順を columnName + order (asc/desc) で複数指定。
 */
import type { ViewDefinition, SortSpec } from "../../../types/v3/view-definition";
import type { Identifier } from "../../../types/v3/common";
import type { ViewDefinitionIssue } from "../../../schemas/viewDefinitionValidator";
import { IssueHints } from "./IssueHints";

interface Props {
  viewDefinition: ViewDefinition;
  columnNames: string[];
  isReadonly: boolean;
  addSortSpec: () => void;
  removeSortSpec: (si: number) => void;
  updateSortSpec: <K extends keyof SortSpec>(si: number, field: K, value: SortSpec[K]) => void;
  sortPath: (si: number, field?: string) => string;
  getIssues: (path: string) => ViewDefinitionIssue[];
}

export function SortDefaultsSection({
  viewDefinition,
  columnNames,
  isReadonly,
  addSortSpec,
  removeSortSpec,
  updateSortSpec,
  sortPath,
  getIssues,
}: Props) {
  const specs = viewDefinition.sortDefaults ?? [];
  return (
    <section className="seq-editor-section">
      <h3 className="seq-editor-section-title">
        既定ソート順
        <span className="vd-editor-col-count">({specs.length} 件)</span>
      </h3>

      {specs.length > 0 && (
        <table className="vd-editor-sub-table">
          <thead>
            <tr>
              <th>カラム名</th>
              <th>順序</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {specs.map((spec, si) => {
              const siIssues = getIssues(sortPath(si));
              return (
                <tr key={si} className={siIssues.some((i) => i.severity === "error") ? "vd-col-row--error" : undefined}>
                  <td>
                    <select
                      value={spec.columnName as string}
                      onChange={(e) => updateSortSpec(si, "columnName", e.target.value as Identifier)}
                      className={siIssues.length > 0 ? "input-error" : undefined}
                      disabled={isReadonly}
                    >
                      <option value="">— カラムを選択 —</option>
                      {columnNames.map((cn) => (
                        <option key={cn} value={cn}>{cn}</option>
                      ))}
                    </select>
                    <IssueHints issues={siIssues} />
                  </td>
                  <td>
                    <select
                      value={spec.order}
                      onChange={(e) => updateSortSpec(si, "order", e.target.value as "asc" | "desc")}
                      disabled={isReadonly}
                    >
                      <option value="asc">asc (昇順)</option>
                      <option value="desc">desc (降順)</option>
                    </select>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="tbl-btn-icon danger"
                      onClick={() => removeSortSpec(si)}
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
        onClick={addSortSpec}
        disabled={isReadonly}
      >
        <i className="bi bi-plus-lg" /> ソート条件追加
      </button>
    </section>
  );
}
