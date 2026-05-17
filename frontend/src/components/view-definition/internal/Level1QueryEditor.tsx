/**
 * Level1QueryEditor — Level 1 (Simple, 1 テーブル) クエリ編集 (Phase-4 抽出)
 *
 * sourceTableId のみのシンプル選択。Level 2/3 と排他的。
 */
import type { ViewDefinition } from "../../../types/v3/view-definition";
import type { TableId } from "../../../types/v3/common";
import type { ViewDefinitionIssue } from "../../../schemas/viewDefinitionValidator";
import { IssueHints } from "./IssueHints";
import type { TableOption } from "./useViewDefinitionTables";

interface Props {
  viewDefinition: ViewDefinition;
  vdId: string;
  tableOptions: TableOption[];
  isReadonly: boolean;
  updateWithDraft: (fn: (s: ViewDefinition) => void) => void;
  getIssues: (path: string) => ViewDefinitionIssue[];
}

export function Level1QueryEditor({
  viewDefinition,
  vdId,
  tableOptions,
  isReadonly,
  updateWithDraft,
  getIssues,
}: Props) {
  const path = `ViewDefinition[${vdId}].sourceTableId`;
  return (
    <div className="seq-editor-grid">
      <div className="tbl-field">
        <span>ソーステーブル <span className="vd-editor-required">*</span></span>
        <select
          value={(viewDefinition.sourceTableId as string | undefined) ?? ""}
          onChange={(e) => updateWithDraft((d) => { d.sourceTableId = e.target.value as TableId; })}
          className={getIssues(path).length > 0 ? "input-error" : undefined}
          disabled={isReadonly}
        >
          <option value="">— テーブルを選択 —</option>
          {tableOptions.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <IssueHints issues={getIssues(path)} />
      </div>
    </div>
  );
}
