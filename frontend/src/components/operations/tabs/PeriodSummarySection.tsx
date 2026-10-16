/** 期間のまとめ (週次サマリー) (続編 第 9 弾 #177): 期間を選ぶと、変更した設計・承認の動き・解決したもの・残りの要確認を、文章と表にして、コピーできる */
import { useState } from "react";
import { buildDesignDocument } from "@harmony/shared";
import { mcpBridge } from "../../../mcp/mcpBridge";
import { reportFailure } from "../../../utils/failureToast";
import { HISTORY_KIND_LABELS } from "../../../utils/designHistory";
import type { MarkerItem } from "../../../utils/markerOverview";
import { opsApi } from "../../../utils/opsApi";
import { defaultPeriod, summarizePeriod, type PeriodSummary } from "../../../utils/periodSummary";
import { writeClipboardText } from "../../../utils/tableExport";
import { showToast } from "../../../utils/toast";
import { Section } from "../../analysis/ui";
import { loadDesignInput } from "../../document/loadDesignInput";
import { formatTime } from "../reviewUtils";

export function PeriodSummarySection() {
  const initial = defaultPeriod();
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PeriodSummary | null>(null);
  const invalid = !from || !to || from > to;

  const make = async () => {
    setBusy(true);
    try {
      const [audit, approvals, comments, markers, { input }] = await Promise.all([
        opsApi.auditList({ limit: 2000 }),
        opsApi.approvalsLoad(),
        opsApi.commentsLoad(),
        mcpBridge.request("listAllMarkers", { unresolvedOnly: false }) as Promise<{ items?: MarkerItem[] } | null>,
        loadDesignInput(),
      ]);
      const names = new Map<string, string>();
      for (const s of input.screens) names.set(`screen:${s.id}`, s.name ?? s.id);
      for (const t of input.tables) names.set(`table:${t.id}`, t.name ?? t.physicalName ?? t.id);
      for (const f of input.flows) names.set(`processFlow:${f.meta.id}`, f.meta.name ?? f.meta.id);
      for (const b of input.businessFlows ?? []) names.set(`businessFlow:${b.id}`, b.name ?? b.id);
      for (const r of input.reports ?? []) names.set(`report:${r.id}`, r.name ?? r.id);
      setResult(summarizePeriod({ from, to, audit: audit.entries, approvals: approvals.rows, threads: comments.threads, markers: markers?.items ?? [], issues: buildDesignDocument(input).issues, names }));
    } catch (e) { reportFailure(e, "期間のまとめの作成"); } finally { setBusy(false); }
  };

  return (
    <Section title="期間のまとめ" hint="期間を選ぶと、変更した設計・承認の動き・解決したマーカーとレビューコメント・いま残っている要確認を、文章と表にします。週次の報告や、引き継ぎに使えます。変更の記録は、直近 2000 件までです。" testId="op-period">
      <div className="an-form-row">
        <label>から<input type="date" className="an-input" value={from} onChange={(e) => setFrom(e.target.value)} data-testid="op-period-from" /></label>
        <label>まで<input type="date" className="an-input" value={to} onChange={(e) => setTo(e.target.value)} data-testid="op-period-to" /></label>
        <button type="button" className="an-btn primary" disabled={busy || invalid} onClick={() => void make()} data-testid="op-period-make"><i className="bi bi-card-text" /> まとめを作る</button>
        {invalid && <small className="an-hint">期間の指定が正しくありません (始まりが終わりより後です)</small>}
      </div>
      {result && (
        <div data-testid="op-period-result">
          <p className="an-hint">変更した設計 {result.changed.length} 件 / 承認の動き {result.approvalEvents.length} 件 / 解決したマーカー {result.resolvedMarkers.length} 件・コメント {result.resolvedThreads} 件 / 要確認 エラー {result.openIssues.error}・警告 {result.openIssues.warning}{result.actors.length ? ` / 編集した人: ${result.actors.join("、")}` : ""}</p>
          {result.changed.length > 0 && (
            <table className="an-table" data-testid="op-period-table">
              <thead><tr><th>設計</th><th>保存</th><th>削除</th><th>最後</th><th>編集した人</th></tr></thead>
              <tbody>{result.changed.map((c) => <tr key={`${c.kind}:${c.id}`}><td>{HISTORY_KIND_LABELS[c.kind]}「{c.name}」</td><td>{c.saves}</td><td>{c.deletes}</td><td style={{ whiteSpace: "nowrap" }}>{formatTime(c.lastAt)}</td><td>{c.actors.join("、")}</td></tr>)}</tbody>
            </table>
          )}
          <pre className="op-period-text" data-testid="op-period-text">{result.text}</pre>
          <button type="button" className="an-btn" onClick={() => writeClipboardText(result.text).then(() => showToast("まとめの文章をコピーしました")).catch((e) => reportFailure(e, "まとめのコピー"))} data-testid="op-period-copy"><i className="bi bi-clipboard" /> 文章をコピー</button>
        </div>
      )}
    </Section>
  );
}
