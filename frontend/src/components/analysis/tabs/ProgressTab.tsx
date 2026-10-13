/**
 * 進捗。画面・処理フロー・テーブル・業務フロー・帳票の完成度 (下書き / 暫定 / 確定) と、確定までの残り、日ごとの推移。
 * 推移は、この画面を開いた日の記録を並べたもの (ワークスペースの .harmony-progress/ に残る。git には載らない)。
 */
import { useEffect, useMemo, useState } from "react";
import { MATURITY_LABELS, MATURITY_ORDER, overallTrend, PROGRESS_KIND_LABELS, summarizeProgress, type DesignDocInput, type ProgressKind, type ProgressSnapshot } from "@harmony/shared";
import { mcpBridge } from "../../../mcp/mcpBridge";
import { AnTable, EntityLink, Empty, Section } from "../ui";

const COLOR: Record<(typeof MATURITY_ORDER)[number], string> = { draft: "var(--hm-fg-faint)", provisional: "var(--hm-warning)", committed: "var(--hm-success)" };

function Bar({ counts }: { counts: { draft: number; provisional: number; committed: number; total: number } }) {
  if (!counts.total) return <span className="an-hint">0 件</span>;
  return (
    <div className="an-bar" role="img" aria-label={MATURITY_ORDER.map((m) => `${MATURITY_LABELS[m]} ${counts[m]} 件`).join("、")}>
      {MATURITY_ORDER.map((m) => counts[m] > 0 && <span key={m} style={{ width: `${(counts[m] / counts.total) * 100}%`, background: COLOR[m] }} />)}
    </div>
  );
}

function Trend({ points }: { points: Array<{ date: string; committed: number; total: number }> }) {
  if (points.length < 2) return <Empty>推移を描くには、2 日分以上の記録が要ります (この画面を開いた日が記録されます)。</Empty>;
  const W = 480, H = 120, P = 24;
  const pct = points.map((p) => (p.total ? (p.committed / p.total) * 100 : 0));
  const x = (i: number) => P + (i / (points.length - 1)) * (W - P * 2);
  const y = (v: number) => H - P - (v / 100) * (H - P * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="an-trend" role="img" aria-label={`確定の割合の推移: ${points.map((p, i) => `${p.date} ${Math.round(pct[i])}%`).join("、")}`} data-testid="an-trend">
      {[0, 50, 100].map((g) => <g key={g}><line x1={P} x2={W - P} y1={y(g)} y2={y(g)} className="an-grid" /><text x={P - 4} y={y(g) + 3} textAnchor="end" className="an-axis">{g}%</text></g>)}
      <polyline fill="none" className="an-line" points={pct.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
      {pct.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={3} className="an-dot"><title>{`${points[i].date}: 確定 ${points[i].committed} / ${points[i].total} (${Math.round(v)}%)`}</title></circle>)}
      <text x={P} y={H - 6} className="an-axis">{points[0].date}</text>
      <text x={W - P} y={H - 6} textAnchor="end" className="an-axis">{points[points.length - 1].date}</text>
    </svg>
  );
}

export function ProgressTab({ input }: { input: DesignDocInput }) {
  const summary = useMemo(() => summarizeProgress(input), [input]);
  const [history, setHistory] = useState<ProgressSnapshot[]>([]);
  const [kind, setKind] = useState<"all" | ProgressKind>("all");

  // 開いたとき・設計が変わったとき、その日の記録を最新にして、推移を読む (記録できなくても、集計は出す)
  useEffect(() => {
    let cancelled = false;
    mcpBridge.request("design.progress", { record: true })
      .then((r) => { if (!cancelled) setHistory((r as { history?: ProgressSnapshot[] }).history ?? []); })
      .catch(() => { if (!cancelled) setHistory([]); });
    return () => { cancelled = true; };
  }, [input]);

  const trend = useMemo(() => overallTrend(history), [history]);
  const remaining = kind === "all" ? summary.remaining : summary.remaining.filter((r) => r.kind === kind);
  const o = summary.overall;

  return (
    <div className="an-pane" data-testid="an-progress">
      <Section title="完成度" hint={`確定 ${o.committed} / ${o.total} 件 (${summary.committedPct}%)。確定までの残りは ${o.draft + o.provisional} 件 (下書き ${o.draft}・暫定 ${o.provisional})。成熟度を決めていないものは、下書きとして数えます。`}>
        <AnTable testId="an-progress-table" headers={["種類", "下書き", "暫定 (レビュー中)", "確定", "合計", "割合"]} empty="設計がありません。" rows={[
          ...summary.byKind.map((k) => [k.label, k.counts.draft, k.counts.provisional, k.counts.committed, k.counts.total, <Bar key="b" counts={k.counts} />]),
          [<b key="a">全体</b>, o.draft, o.provisional, o.committed, o.total, <Bar key="b" counts={o} />],
        ]} />
        <div className="an-legend">{MATURITY_ORDER.map((m) => <span key={m}><i style={{ background: COLOR[m] }} /> {MATURITY_LABELS[m]}</span>)}</div>
      </Section>
      <Section title="確定の割合の推移" hint="この画面を開いた日の記録です。" testId="an-progress-trend"><Trend points={trend} /></Section>
      <Section title={`確定までの残り (${remaining.length} 件)`} testId="an-progress-remaining"
        actions={<select className="an-input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="種類で絞る"><option value="all">すべて</option>{(Object.keys(PROGRESS_KIND_LABELS) as ProgressKind[]).map((k) => <option key={k} value={k}>{PROGRESS_KIND_LABELS[k]}</option>)}</select>}>
        <AnTable headers={["種類", "設計", "成熟度"]} empty="確定していない設計はありません。" rows={remaining.map((r) => [PROGRESS_KIND_LABELS[r.kind], <EntityLink key="l" kind={r.ref.kind} id={r.id}>{r.name}</EntityLink>, MATURITY_LABELS[r.maturity]])} />
      </Section>
    </div>
  );
}
