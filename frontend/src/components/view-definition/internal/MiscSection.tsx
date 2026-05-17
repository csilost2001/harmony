/**
 * MiscSection — Section 6: その他 (Phase-4 抽出)
 *
 * pageSize / groupBy 等の補助オプション。
 */
import type { ViewDefinition } from "../../../types/v3/view-definition";
import type { Identifier } from "../../../types/v3/common";
import type { ViewDefinitionIssue } from "../../../schemas/viewDefinitionValidator";
import { IssueHints } from "./IssueHints";

interface Props {
  viewDefinition: ViewDefinition;
  vdId: string;
  columnNames: string[];
  isReadonly: boolean;
  updateWithDraft: (fn: (s: ViewDefinition) => void) => void;
  getIssues: (path: string) => ViewDefinitionIssue[];
}

export function MiscSection({
  viewDefinition,
  vdId,
  columnNames,
  isReadonly,
  updateWithDraft,
  getIssues,
}: Props) {
  const groupByPath = `ViewDefinition[${vdId}].groupBy`;
  return (
    <section className="seq-editor-section">
      <h3 className="seq-editor-section-title">その他</h3>
      <div className="seq-editor-grid">

        {/* pageSize */}
        <label className="tbl-field">
          <span>ページサイズ <small>(1..1000)</small></span>
          <input
            type="number"
            value={viewDefinition.pageSize ?? ""}
            min={1}
            max={1000}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : undefined;
              updateWithDraft((d) => { d.pageSize = v; });
            }}
            placeholder="20"
            className="vd-editor-number-input"
            disabled={isReadonly}
          />
        </label>

        {/* groupBy */}
        <div className="tbl-field">
          <span>groupBy</span>
          <select
            value={viewDefinition.groupBy ?? ""}
            onChange={(e) => updateWithDraft((d) => {
              d.groupBy = (e.target.value || undefined) as Identifier | undefined;
            })}
            className={getIssues(groupByPath).length > 0 ? "input-error" : undefined}
            disabled={isReadonly}
          >
            <option value="">— なし —</option>
            {columnNames.map((cn) => (
              <option key={cn} value={cn}>{cn}</option>
            ))}
          </select>
          <IssueHints issues={getIssues(groupByPath)} />
        </div>

      </div>
    </section>
  );
}
