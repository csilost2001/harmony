/**
 * Level3QueryEditor — Level 3 (Raw SQL + parameterRefs) クエリ編集 (Phase-4 抽出)
 *
 * raw SQL textarea + parameterRefs テーブル。式補間は ProcessFlow と同じ
 * (`@var` / `@conv.*` / `@env.*` / `@param.<name>`)。
 */
import type {
  ViewDefinition,
  ViewQueryRawSql,
  ViewQueryParameterRef,
} from "../../../types/v3/view-definition";
import type { Identifier } from "../../../types/v3/common";
import type { FieldType } from "../../../types/v3";
import { FIELD_TYPE_OPTIONS } from "./viewDefinitionConstants";

interface Props {
  viewDefinition: ViewDefinition;
  isReadonly: boolean;
  updateWithDraft: (fn: (s: ViewDefinition) => void) => void;
  updateSilentWithDraft: (fn: (s: ViewDefinition) => void) => void;
  commit: () => void;
}

export function Level3QueryEditor({
  viewDefinition,
  isReadonly,
  updateWithDraft,
  updateSilentWithDraft,
  commit,
}: Props) {
  const rq = (viewDefinition.query as ViewQueryRawSql | undefined) ?? { sql: "", parameterRefs: [] };
  return (
    <div className="vd-query-rawsql">
      <div className="vd-query-block">
        <div className="vd-query-block-title">SQL</div>
        <textarea
          value={rq.sql ?? ""}
          onChange={(e) => updateSilentWithDraft((d) => {
            const cur = (d.query as ViewQueryRawSql | undefined) ?? { sql: "", parameterRefs: [] };
            d.query = { ...cur, sql: e.target.value };
          })}
          onBlur={() => { if (!isReadonly) commit(); }}
          placeholder={"WITH ranked AS (\n  SELECT id, name, ROW_NUMBER() OVER (PARTITION BY category ORDER BY price DESC) AS rn FROM products\n)\nSELECT * FROM ranked WHERE rn <= @param.topN"}
          rows={12}
          className="vd-query-sql-textarea"
          disabled={isReadonly}
        />
        <small className="vd-editor-level-hint">
          式補間は ProcessFlow と同じく <code>@&lt;var&gt;</code> / <code>@conv.*</code> / <code>@env.*</code> / <code>@param.&lt;name&gt;</code>。
        </small>
      </div>

      <div className="vd-query-block">
        <div className="vd-query-block-title">parameterRefs</div>
        {(rq.parameterRefs ?? []).map((p, pi) => (
          <div key={pi} className="vd-query-fragment-row">
            <input
              type="text"
              value={p.name as string}
              onChange={(e) => updateSilentWithDraft((d) => {
                const cur = d.query as ViewQueryRawSql;
                const params = [...(cur.parameterRefs ?? [])];
                params[pi] = { ...params[pi], name: e.target.value as Identifier };
                d.query = { ...cur, parameterRefs: params };
              })}
              onBlur={() => { if (!isReadonly) commit(); }}
              placeholder="paramName"
              className="vd-query-fragment-input"
              disabled={isReadonly}
            />
            <select
              value={typeof p.fieldType === "string" ? p.fieldType : "string"}
              onChange={(e) => updateWithDraft((d) => {
                const cur = d.query as ViewQueryRawSql;
                const params = [...(cur.parameterRefs ?? [])];
                params[pi] = { ...params[pi], fieldType: e.target.value as FieldType };
                d.query = { ...cur, parameterRefs: params };
              })}
              disabled={isReadonly}
            >
              {FIELD_TYPE_OPTIONS.map((ft) => (
                <option key={ft} value={ft}>{ft}</option>
              ))}
            </select>
            <input
              type="text"
              value={p.description ?? ""}
              onChange={(e) => updateSilentWithDraft((d) => {
                const cur = d.query as ViewQueryRawSql;
                const params = [...(cur.parameterRefs ?? [])];
                params[pi] = { ...params[pi], description: e.target.value || undefined };
                d.query = { ...cur, parameterRefs: params };
              })}
              onBlur={() => { if (!isReadonly) commit(); }}
              placeholder="description (任意)"
              className="vd-query-fragment-input vd-query-fragment-input--full"
              disabled={isReadonly}
            />
            <button
              type="button"
              className="tbl-btn-icon danger"
              onClick={() => updateWithDraft((d) => {
                const cur = d.query as ViewQueryRawSql;
                const params = (cur.parameterRefs ?? []).filter((_, i) => i !== pi);
                d.query = { ...cur, parameterRefs: params.length ? params : undefined };
              })}
              disabled={isReadonly}
              title="削除"
            >
              <i className="bi bi-trash" />
            </button>
          </div>
        ))}
        <button
          type="button"
          className="tbl-btn tbl-btn-ghost tbl-btn-sm"
          onClick={() => updateWithDraft((d) => {
            const cur = (d.query as ViewQueryRawSql | undefined) ?? { sql: "" };
            const newParam: ViewQueryParameterRef = {
              name: "" as Identifier,
              fieldType: "string" as FieldType,
            };
            d.query = { ...cur, parameterRefs: [...(cur.parameterRefs ?? []), newParam] };
          })}
          disabled={isReadonly}
        >
          <i className="bi bi-plus-lg" /> parameterRef 追加
        </button>
      </div>
    </div>
  );
}
