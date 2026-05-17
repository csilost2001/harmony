/**
 * ColumnsSection — Section 3: columns 編集 (Phase-4 抽出)
 *
 * Level に応じて tableColumnRef 列を切替 (Level 1/2 = 参照テーブル/カラム cascade、Level 3 = 非表示)。
 * 移動・削除・追加・各 cell 編集 + 列ごとの issue 集計表示。
 *
 * columns 操作 (addColumn / removeColumn / moveColumn / setColRefTable / setColRefColumn / updateColumn) は
 * 親コンポーネントが colRefTableIds state を保持しているため props 経由で受け取る。
 */
import type {
  ViewDefinition,
  ViewColumn,
} from "../../../types/v3/view-definition";
import type { Identifier } from "../../../types/v3/common";
import type { FieldType } from "../../../types/v3";
import type { ViewDefinitionIssue } from "../../../schemas/viewDefinitionValidator";
import { IssueHints } from "./IssueHints";
import { FIELD_TYPE_OPTIONS } from "./viewDefinitionConstants";
import type { TableOption } from "./useViewDefinitionTables";
import type { ViewLevel } from "../viewDefinitionLevels";

interface InScopeTable {
  tableId: string;
  alias: string;
  label: string;
  tableName: string;
}

interface Props {
  viewDefinition: ViewDefinition;
  currentLevel: ViewLevel;
  tableOptions: TableOption[];
  inScopeTables: InScopeTable[];
  colRefTableIds: Record<number, string>;
  isReadonly: boolean;
  // column-level handlers
  addColumn: () => void;
  removeColumn: (ci: number) => void;
  moveColumn: (ci: number, direction: "up" | "down") => void;
  updateColumn: <K extends keyof ViewColumn>(ci: number, field: K, value: ViewColumn[K]) => void;
  setColRefTable: (ci: number, tableId: string) => void;
  setColRefColumn: (ci: number, columnId: string) => void;
  // generic update (for free-form fields)
  updateSilentWithDraft: (fn: (s: ViewDefinition) => void) => void;
  updateWithDraft: (fn: (s: ViewDefinition) => void) => void;
  commit: () => void;
  // issue lookup
  colPath: (ci: number, colName: string, field?: string) => string;
  getIssues: (path: string) => ViewDefinitionIssue[];
}

export function ColumnsSection({
  viewDefinition,
  currentLevel,
  tableOptions,
  inScopeTables,
  colRefTableIds,
  isReadonly,
  addColumn,
  removeColumn,
  moveColumn,
  updateColumn,
  setColRefTable,
  setColRefColumn,
  updateSilentWithDraft,
  updateWithDraft,
  commit,
  colPath,
  getIssues,
}: Props) {
  return (
    <section className="seq-editor-section">
      <h3 className="seq-editor-section-title">
        カラム定義
        <span className="vd-editor-col-count">
          ({(viewDefinition.columns ?? []).length} 件)
        </span>
      </h3>

      <div className="vd-editor-columns-table-wrap">
        <table className="vd-editor-columns-table">
          <thead>
            <tr>
              <th>name <span className="vd-editor-required">*</span></th>
              {currentLevel !== 3 && (
                <>
                  <th title={currentLevel === 2 ? "from / joins[] のテーブルから選択" : "参照テーブル"}>
                    {currentLevel === 2 ? "alias.テーブル" : "参照テーブル"}
                  </th>
                  <th>参照カラム</th>
                </>
              )}
              <th>表示名</th>
              <th>type <span className="vd-editor-required">*</span></th>
              <th>書式</th>
              <th>幅</th>
              <th>align</th>
              <th title="ソート可能">sort</th>
              <th title="フィルタ可能">filter</th>
              <th>linkTo</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {(viewDefinition.columns ?? []).map((col, ci) => {
              const colName = col.name as string;
              const refTableId = colRefTableIds[ci] ?? col.tableColumnRef?.tableId ?? viewDefinition.sourceTableId;
              const colOptions = tableOptions.find((t) => t.id === refTableId)?.columns ?? [];
              const basePath = colPath(ci, colName);
              const colIssues = [
                ...getIssues(basePath),
                ...getIssues(`${basePath}.tableColumnRef`),
                ...getIssues(`${basePath}.type`),
              ];

              return (
                <tr key={ci} className={colIssues.some((i) => i.severity === "error") ? "vd-col-row--error" : colIssues.some((i) => i.severity === "warning") ? "vd-col-row--warning" : undefined}>
                  {/* name */}
                  <td>
                    <input
                      type="text"
                      value={col.name as string}
                      onChange={(e) => updateSilentWithDraft((d) => {
                        d.columns[ci] = { ...d.columns[ci], name: e.target.value as Identifier };
                      })}
                      onBlur={() => { if (!isReadonly) commit(); }}
                      placeholder="columnName"
                      className="vd-col-input-sm"
                      title="camelCase 識別子"
                      disabled={isReadonly}
                    />
                  </td>
                  {currentLevel !== 3 && (
                    <>
                      {/* 参照テーブル (cascade step 1) — Level 2 では in-scope alias リスト */}
                      <td>
                        <select
                          value={refTableId ?? ""}
                          onChange={(e) => setColRefTable(ci, e.target.value)}
                          className="vd-col-select"
                          disabled={isReadonly}
                        >
                          <option value="">— テーブル —</option>
                          {currentLevel === 2
                            ? inScopeTables.map((s) => (
                                <option key={`${s.alias}-${s.tableId}`} value={s.tableId}>
                                  {s.label}
                                </option>
                              ))
                            : tableOptions.map((t) => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                        </select>
                      </td>
                      {/* 参照カラム (cascade step 2) */}
                      <td>
                        <select
                          value={col.tableColumnRef?.columnId ?? ""}
                          onChange={(e) => setColRefColumn(ci, e.target.value)}
                          className="vd-col-select"
                          disabled={!refTableId || isReadonly}
                        >
                          <option value="">— カラム —</option>
                          {colOptions.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </td>
                    </>
                  )}
                  {/* displayName */}
                  <td>
                    <input
                      type="text"
                      value={col.displayName ?? ""}
                      onChange={(e) => updateSilentWithDraft((d) => {
                        d.columns[ci] = {
                          ...d.columns[ci],
                          displayName: (e.target.value || undefined) as ViewColumn["displayName"],
                        };
                      })}
                      onBlur={() => { if (!isReadonly) commit(); }}
                      placeholder="表示名"
                      className="vd-col-input-sm"
                      disabled={isReadonly}
                    />
                  </td>
                  {/* type */}
                  <td>
                    <select
                      value={typeof col.type === "string" ? col.type : "string"}
                      onChange={(e) => updateColumn(ci, "type", e.target.value as FieldType)}
                      className="vd-col-select"
                      disabled={isReadonly}
                    >
                      {FIELD_TYPE_OPTIONS.map((ft) => (
                        <option key={ft} value={ft}>{ft}</option>
                      ))}
                    </select>
                  </td>
                  {/* displayFormat */}
                  <td>
                    <input
                      type="text"
                      value={col.displayFormat ?? ""}
                      onChange={(e) => updateSilentWithDraft((d) => {
                        d.columns[ci] = { ...d.columns[ci], displayFormat: e.target.value || undefined };
                      })}
                      onBlur={() => { if (!isReadonly) commit(); }}
                      placeholder="#,##0"
                      className="vd-col-input-xs"
                      disabled={isReadonly}
                    />
                  </td>
                  {/* width */}
                  <td>
                    <input
                      type="text"
                      value={col.width ?? ""}
                      onChange={(e) => updateSilentWithDraft((d) => {
                        d.columns[ci] = { ...d.columns[ci], width: e.target.value || undefined };
                      })}
                      onBlur={() => { if (!isReadonly) commit(); }}
                      placeholder="120px"
                      className="vd-col-input-xs"
                      disabled={isReadonly}
                    />
                  </td>
                  {/* align */}
                  <td>
                    <select
                      value={col.align ?? ""}
                      onChange={(e) => updateWithDraft((d) => {
                        d.columns[ci] = {
                          ...d.columns[ci],
                          align: (e.target.value || undefined) as ViewColumn["align"],
                        };
                      })}
                      className="vd-col-select-xs"
                      disabled={isReadonly}
                    >
                      <option value="">—</option>
                      <option value="left">left</option>
                      <option value="center">center</option>
                      <option value="right">right</option>
                    </select>
                  </td>
                  {/* sortable */}
                  <td className="vd-col-center">
                    <input
                      type="checkbox"
                      checked={col.sortable ?? false}
                      onChange={(e) => updateWithDraft((d) => {
                        d.columns[ci] = { ...d.columns[ci], sortable: e.target.checked || undefined };
                      })}
                      disabled={isReadonly}
                    />
                  </td>
                  {/* filterable */}
                  <td className="vd-col-center">
                    <input
                      type="checkbox"
                      checked={col.filterable ?? false}
                      onChange={(e) => updateWithDraft((d) => {
                        d.columns[ci] = { ...d.columns[ci], filterable: e.target.checked || undefined };
                      })}
                      disabled={isReadonly}
                    />
                  </td>
                  {/* linkTo */}
                  <td>
                    <input
                      type="text"
                      value={col.linkTo ?? ""}
                      onChange={(e) => updateSilentWithDraft((d) => {
                        d.columns[ci] = { ...d.columns[ci], linkTo: e.target.value || undefined };
                      })}
                      onBlur={() => { if (!isReadonly) commit(); }}
                      placeholder="/orders/:id"
                      className="vd-col-input-sm"
                      disabled={isReadonly}
                    />
                  </td>
                  {/* 操作 */}
                  <td className="vd-col-ops">
                    <button
                      type="button"
                      className="tbl-btn-icon"
                      onClick={() => moveColumn(ci, "up")}
                      disabled={ci === 0 || isReadonly}
                      title="上に移動"
                    >
                      <i className="bi bi-arrow-up" />
                    </button>
                    <button
                      type="button"
                      className="tbl-btn-icon"
                      onClick={() => moveColumn(ci, "down")}
                      disabled={ci === (viewDefinition.columns?.length ?? 0) - 1 || isReadonly}
                      title="下に移動"
                    >
                      <i className="bi bi-arrow-down" />
                    </button>
                    <button
                      type="button"
                      className="tbl-btn-icon danger"
                      onClick={() => removeColumn(ci)}
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
      </div>

      {/* 列ごとの issue 表示 */}
      {(viewDefinition.columns ?? []).map((col, ci) => {
        const colName = col.name as string;
        const basePath = colPath(ci, colName);
        const colIssues = [
          ...getIssues(basePath),
          ...getIssues(`${basePath}.tableColumnRef`),
          ...getIssues(`${basePath}.type`),
        ];
        if (colIssues.length === 0) return null;
        return (
          <div key={ci} className="vd-editor-col-issues">
            <span className="vd-editor-col-issues-label">
              カラム {ci + 1} ({colName || "未設定"}):
            </span>
            <IssueHints issues={colIssues} />
          </div>
        );
      })}

      <button
        type="button"
        className="tbl-btn tbl-btn-ghost vd-editor-add-row-btn"
        onClick={addColumn}
        disabled={isReadonly}
      >
        <i className="bi bi-plus-lg" /> カラム追加
      </button>
    </section>
  );
}
