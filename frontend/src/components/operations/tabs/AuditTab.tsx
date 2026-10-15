/** 変更の記録 (監査ログ): 誰が・いつ・何を変えたか。利用者名は自己申告 (本人確認ではない) */
import { useEffect, useState } from "react";
import { AnTable, Section } from "../../analysis/ui";
import { saveTextFile, withBom } from "../../analysis/fileIo";
import { opsApi } from "../../../utils/opsApi";
import { useLoad } from "../useLoad";
import { formatTime } from "../reviewUtils";

export function AuditTab() {
  const [actor, setActor] = useState("");
  const [q, setQ] = useState("");
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [applied, setApplied] = useState({ actor: "", q: "", since: "", until: "" });
  useEffect(() => { const t = setTimeout(() => setApplied({ actor, q, since, until }), 250); return () => clearTimeout(t); }, [actor, q, since, until]);
  const log = useLoad(() => opsApi.auditList({ ...(applied.actor ? { actor: applied.actor } : {}), ...(applied.q ? { q: applied.q } : {}), ...(applied.since ? { since: `${applied.since}T00:00:00` } : {}), ...(applied.until ? { until: `${applied.until}T23:59:59.999Z` } : {}), limit: 500 }));
  const { reload } = log;
  useEffect(() => { reload(); }, [applied, reload]);
  const d = log.data;
  const csv = () => {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    saveTextFile("audit-log.csv", withBom(["日時,利用者,操作,対象,内容", ...(d?.entries ?? []).map((e) => [e.at, e.actor, e.action, e.target ?? "", e.detail ?? ""].map(esc).join(","))].join("\n")), "text/csv");
  };
  return (
    <div className="an-pane" data-testid="op-audit">
      <Section title="変更の記録" hint="画面と AI からの、設計・設定の変更の記録です (新しい順)。利用者名はブラウザごとの自己申告で、本人確認ではありません。記録は、このワークスペースの .harmony-ops/ に残り、git には載りません。" testId="op-audit-section"
        actions={<button type="button" className="an-btn" disabled={!d?.entries.length} onClick={csv} data-testid="op-audit-csv"><i className="bi bi-download" /> CSV で保存</button>}>
        <div className="an-form-row">
          <label>利用者<select className="an-input" value={actor} onChange={(e) => setActor(e.target.value)} data-testid="op-audit-actor"><option value="">すべて</option>{(d?.actors ?? []).map((a) => <option key={a} value={a}>{a}</option>)}</select></label>
          <label>語で探す<input className="an-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="例: テーブル" data-testid="op-audit-q" /></label>
          <label>から<input type="date" className="an-input" value={since} onChange={(e) => setSince(e.target.value)} /></label>
          <label>まで<input type="date" className="an-input" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
        </div>
        {log.error ? <p className="an-alert" role="alert">{log.error}</p> : null}
        <p className="an-hint" data-testid="op-audit-count">{d ? `${d.total} 件${d.total > d.entries.length ? ` (新しい ${d.entries.length} 件を表示)` : ""}` : "読み込み中…"}</p>
        <AnTable testId="op-audit-table" headers={["日時", "利用者", "操作", "対象", "内容"]} empty="記録はまだありません。設計を保存すると、ここに残ります。" limit={500}
          rows={(d?.entries ?? []).map((e) => [<span key="t" style={{ whiteSpace: "nowrap" }}>{formatTime(e.at)}</span>, <span key="a">{e.actor}{e.via === "ai" ? <small className="an-hint"> (AI)</small> : null}</span>, e.action, e.target ?? "", e.detail ?? ""])} />
      </Section>
    </div>
  );
}
