/**
 * Level2QueryEditor — Level 2 (Structured: from + joins + where/groupBy/having/orderBy) (Phase-4 抽出)
 *
 * FROM / JOINS / WHERE / GROUP BY / HAVING / ORDER BY のフラグメント編集 UI。
 * 各フラグメントは AND 結合の式文字列で、AI/runtime 側で query へ展開する。
 */
import type {
  ViewDefinition,
  ViewQueryStructured,
  ViewQueryJoin,
} from "../../../types/v3/view-definition";
import type { TableId } from "../../../types/v3/common";
import type { ViewDefinitionIssue } from "../../../schemas/viewDefinitionValidator";
import { IssueHints } from "./IssueHints";
import { JOIN_KIND_OPTIONS } from "./viewDefinitionConstants";
import { suggestAlias } from "../viewDefinitionLevels";
import type { TableOption } from "./useViewDefinitionTables";

interface Props {
  viewDefinition: ViewDefinition;
  vdId: string;
  tableOptions: TableOption[];
  isReadonly: boolean;
  updateWithDraft: (fn: (s: ViewDefinition) => void) => void;
  updateSilentWithDraft: (fn: (s: ViewDefinition) => void) => void;
  commit: () => void;
  getIssues: (path: string) => ViewDefinitionIssue[];
}

export function Level2QueryEditor({
  viewDefinition,
  vdId,
  tableOptions,
  isReadonly,
  updateWithDraft,
  updateSilentWithDraft,
  commit,
  getIssues,
}: Props) {
  const sq = (viewDefinition.query as ViewQueryStructured | undefined) ?? {
    from: { tableId: "" as TableId, alias: "a" },
  };
  const fromIssuePath = `ViewDefinition[${vdId}].query.from.tableId`;
  return (
    <div className="vd-query-structured">
      {/* FROM */}
      <div className="vd-query-row">
        <span className="vd-query-label">FROM</span>
        <select
          value={(sq.from?.tableId as string | undefined) ?? ""}
          onChange={(e) => updateWithDraft((d) => {
            const cur = (d.query as ViewQueryStructured | undefined) ?? { from: { tableId: "" as TableId, alias: "a" } };
            d.query = { ...cur, from: { ...cur.from, tableId: e.target.value as TableId } };
          })}
          className={getIssues(fromIssuePath).length > 0 ? "input-error" : undefined}
          disabled={isReadonly}
        >
          <option value="">— テーブル —</option>
          {tableOptions.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <span className="vd-query-as">AS</span>
        <input
          type="text"
          value={sq.from?.alias ?? ""}
          onChange={(e) => updateSilentWithDraft((d) => {
            const cur = (d.query as ViewQueryStructured | undefined) ?? { from: { tableId: "" as TableId, alias: "" } };
            d.query = { ...cur, from: { ...cur.from, alias: e.target.value } };
          })}
          onBlur={() => { if (!isReadonly) commit(); }}
          placeholder="alias"
          className="vd-query-alias-input"
          pattern="^[a-z][a-z0-9_]*$"
          title="snake_case (^[a-z][a-z0-9_]*$)"
          disabled={isReadonly}
        />
      </div>
      <IssueHints issues={getIssues(fromIssuePath)} />

      {/* JOINS */}
      <div className="vd-query-block">
        <div className="vd-query-block-title">JOINS</div>
        {(sq.joins ?? []).map((j, ji) => {
          const joinIssuePath = `ViewDefinition[${vdId}].query.joins[${ji}].tableId`;
          const aliasIssuePath = `ViewDefinition[${vdId}].query.joins[${ji}].alias`;
          return (
            <div key={ji} className="vd-query-join-row">
              <select
                value={j.kind}
                onChange={(e) => updateWithDraft((d) => {
                  const cur = d.query as ViewQueryStructured;
                  const joins = [...(cur.joins ?? [])];
                  joins[ji] = { ...joins[ji], kind: e.target.value as ViewQueryJoin["kind"] };
                  d.query = { ...cur, joins };
                })}
                disabled={isReadonly}
              >
                {JOIN_KIND_OPTIONS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <span className="vd-query-as">JOIN</span>
              <select
                value={(j.tableId as string | undefined) ?? ""}
                onChange={(e) => updateWithDraft((d) => {
                  const cur = d.query as ViewQueryStructured;
                  const joins = [...(cur.joins ?? [])];
                  joins[ji] = { ...joins[ji], tableId: e.target.value as TableId };
                  d.query = { ...cur, joins };
                })}
                className={getIssues(joinIssuePath).length > 0 ? "input-error" : undefined}
                disabled={isReadonly}
              >
                <option value="">— テーブル —</option>
                {tableOptions.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <span className="vd-query-as">AS</span>
              <input
                type="text"
                value={j.alias}
                onChange={(e) => updateSilentWithDraft((d) => {
                  const cur = d.query as ViewQueryStructured;
                  const joins = [...(cur.joins ?? [])];
                  joins[ji] = { ...joins[ji], alias: e.target.value };
                  d.query = { ...cur, joins };
                })}
                onBlur={() => { if (!isReadonly) commit(); }}
                placeholder="alias"
                className={`vd-query-alias-input${getIssues(aliasIssuePath).length > 0 ? " input-error" : ""}`}
                disabled={isReadonly}
              />
              <span className="vd-query-as">ON</span>
              <div className="vd-query-on-list">
                {j.on.map((cond, oi) => (
                  <input
                    key={oi}
                    type="text"
                    value={cond}
                    onChange={(e) => updateSilentWithDraft((d) => {
                      const cur = d.query as ViewQueryStructured;
                      const joins = [...(cur.joins ?? [])];
                      const on = [...(joins[ji].on ?? [])];
                      on[oi] = e.target.value;
                      joins[ji] = { ...joins[ji], on };
                      d.query = { ...cur, joins };
                    })}
                    onBlur={() => { if (!isReadonly) commit(); }}
                    placeholder="o.customer_id = c.id"
                    className="vd-query-fragment-input"
                    disabled={isReadonly}
                  />
                ))}
                <button
                  type="button"
                  className="tbl-btn-icon"
                  onClick={() => updateWithDraft((d) => {
                    const cur = d.query as ViewQueryStructured;
                    const joins = [...(cur.joins ?? [])];
                    const on = [...(joins[ji].on ?? []), ""];
                    joins[ji] = { ...joins[ji], on };
                    d.query = { ...cur, joins };
                  })}
                  disabled={isReadonly}
                  title="ON 条件追加 (AND 結合)"
                >
                  <i className="bi bi-plus-lg" />
                </button>
              </div>
              <button
                type="button"
                className="tbl-btn-icon danger"
                onClick={() => updateWithDraft((d) => {
                  const cur = d.query as ViewQueryStructured;
                  const joins = (cur.joins ?? []).filter((_, i) => i !== ji);
                  d.query = { ...cur, joins: joins.length ? joins : undefined };
                })}
                disabled={isReadonly}
                title="JOIN 削除"
              >
                <i className="bi bi-trash" />
              </button>
              <IssueHints issues={[...getIssues(joinIssuePath), ...getIssues(aliasIssuePath)]} />
            </div>
          );
        })}
        <button
          type="button"
          className="tbl-btn tbl-btn-ghost"
          onClick={() => updateWithDraft((d) => {
            const cur = (d.query as ViewQueryStructured | undefined) ?? { from: { tableId: "" as TableId, alias: "a" } };
            const usedAliases = new Set<string>([cur.from?.alias ?? ""]);
            (cur.joins ?? []).forEach((j) => usedAliases.add(j.alias));
            const newJoin: ViewQueryJoin = {
              kind: "INNER",
              tableId: "" as TableId,
              alias: suggestAlias(undefined, usedAliases),
              on: [""],
            };
            d.query = { ...cur, joins: [...(cur.joins ?? []), newJoin] };
          })}
          disabled={isReadonly}
        >
          <i className="bi bi-plus-lg" /> JOIN 追加
        </button>
      </div>

      {/* WHERE / GROUP BY / HAVING / ORDER BY */}
      {(["where", "groupBy", "having", "orderBy"] as const).map((kw) => {
        const items = (sq[kw] ?? []) as string[];
        const labelMap = {
          where: ["WHERE", "AND 結合される条件式 (例: \"o.status = 'active'\")"],
          groupBy: ["GROUP BY", "GROUP BY 列式 (例: \"o.customer_id\")"],
          having: ["HAVING", "AND 結合される HAVING 条件 (例: \"COUNT(*) > 10\")"],
          orderBy: ["ORDER BY", "ORDER BY 式 (例: \"o.created_at DESC\")"],
        } as const;
        const [label, hint] = labelMap[kw];
        return (
          <div key={kw} className="vd-query-block">
            <div className="vd-query-block-title" title={hint}>{label}</div>
            {items.map((cond, idx) => (
              <div key={idx} className="vd-query-fragment-row">
                <input
                  type="text"
                  value={cond}
                  onChange={(e) => updateSilentWithDraft((d) => {
                    const cur = d.query as ViewQueryStructured;
                    const arr = [...((cur[kw] as string[] | undefined) ?? [])];
                    arr[idx] = e.target.value;
                    d.query = { ...cur, [kw]: arr };
                  })}
                  onBlur={() => { if (!isReadonly) commit(); }}
                  placeholder={hint}
                  className="vd-query-fragment-input vd-query-fragment-input--full"
                  disabled={isReadonly}
                />
                <button
                  type="button"
                  className="tbl-btn-icon danger"
                  onClick={() => updateWithDraft((d) => {
                    const cur = d.query as ViewQueryStructured;
                    const arr = ((cur[kw] as string[] | undefined) ?? []).filter((_, i) => i !== idx);
                    d.query = { ...cur, [kw]: arr.length ? arr : undefined };
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
                const cur = d.query as ViewQueryStructured;
                const arr = [...((cur[kw] as string[] | undefined) ?? []), ""];
                d.query = { ...cur, [kw]: arr };
              })}
              disabled={isReadonly}
            >
              <i className="bi bi-plus-lg" /> {label} 追加
            </button>
          </div>
        );
      })}
    </div>
  );
}
