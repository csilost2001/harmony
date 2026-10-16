/**
 * カラムの変更が、ほかの設計に及ぼす影響の知らせ (UI 改善提案 続編 第 8 弾 #152)。
 * 保存した列と比べて、型・桁・NOT NULL・主キー・ユニークを変えた列・消した列があると、帯を出す。
 * 「影響を調べる」を押すと、保存してある設計 (画面・処理フロー・業務フロー・帳票) を読み、その列に頼っているものを、件数と名前で出す
 * (調べるのは押したときだけ。大きなプロジェクトでは、設計全体を読むため)。変更は止めない。
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { analyzeImpact, buildDesignGraph } from "@harmony/shared";
import type { Column } from "../../types/v3";
import { changedColumns, summarizeImpact, type ColumnChange, type ImpactSummary } from "../../utils/columnImpact";
import { loadDesignInput } from "../document/loadDesignInput";
import { ROUTES } from "../../utils/relatedDesigns";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { reportFailure } from "../../utils/failureToast";

interface Props { tableId: string; baseline: readonly Column[] | undefined; columns: readonly Column[] }

export function ColumnImpactNotice({ tableId, baseline, columns }: Props) {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const changes = useMemo(() => changedColumns(baseline, columns), [baseline, columns]);
  const [state, setState] = useState<{ key: string; busy: boolean; results: Array<{ change: ColumnChange; summary: ImpactSummary }> } | null>(null);
  if (changes.length === 0) return null;
  const key = changes.map((c) => `${c.columnId}:${c.changes.join("|")}`).join(";");
  // 変更が変わったら、前の調べた結果は古い
  const shown = state && state.key === key ? state : null;

  const run = async () => {
    setState({ key, busy: true, results: [] });
    try {
      const { input } = await loadDesignInput();
      const graph = buildDesignGraph(input);
      const results = changes.map((c) => ({ change: c, summary: summarizeImpact(analyzeImpact(input, "table", tableId, { column: c.columnId }, graph)) }));
      setState({ key, busy: false, results });
    } catch (e) {
      setState(null);
      reportFailure(e, "カラムの変更の影響の調査");
    }
  };

  return (
    <div className="col-impact" role="status" data-testid="column-impact-notice">
      <div className="col-impact-head">
        <i className="bi bi-exclamation-triangle" />
        <span>保存した内容から、{changes.length} 個のカラムの型・桁・制約を変えています ({changes.slice(0, 3).map((c) => c.name).join("、")}{changes.length > 3 ? " ほか" : ""})。ほかの設計に影響することがあります。</span>
        <button type="button" className="tbl-btn tbl-btn-ghost tbl-btn-sm" onClick={() => void run()} disabled={shown?.busy} data-testid="column-impact-run">
          {shown?.busy ? "調べています…" : shown ? "調べ直す" : "影響を調べる"}
        </button>
      </div>
      {shown && !shown.busy && (
        <ul className="col-impact-list" data-testid="column-impact-result">
          {shown.results.map(({ change, summary }) => (
            <li key={change.columnId}>
              <b>{change.name}</b> <code>{change.physicalName}</code> — {change.changes.join("、")}:
              {summary.total === 0
                ? <span className="col-impact-ok"> 頼っている設計は見つかりません</span>
                : <> 影響 {summary.total} 件 ({summary.byKind.map((k) => `${k.label} ${k.count}`).join("・")})
                    <span className="col-impact-names">{summary.names.map((n) => {
                      const route = ROUTES[n.kind]?.(n.id);
                      return route ? <button key={`${n.kind}:${n.id}`} type="button" className="col-impact-link" onClick={() => navigate(wsPath(route))}>{n.name}</button> : <span key={`${n.kind}:${n.id}`}>{n.name}</span>;
                    })}{summary.total > summary.names.length ? <span> ほか</span> : null}</span></>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
