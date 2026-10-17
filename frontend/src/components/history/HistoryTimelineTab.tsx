/** 変更の記録: この設計を、誰が・いつ・何をしたか (監査ログから)。最終編集者を先頭に出す */
import { useMemo } from "react";
import { actionVerb, designTimeline, lastEditOf, type TabDesign } from "../../utils/designHistory";
import { opsApi } from "../../utils/opsApi";
import { useLoad } from "../operations/useLoad";
import { formatTime } from "../operations/reviewUtils";

export function HistoryTimelineTab({ design, onCompare }: { design: TabDesign; onCompare: () => void }) {
  const log = useLoad(() => opsApi.auditList({ limit: 2000 }));
  const entries = useMemo(() => designTimeline(log.data?.entries ?? [], design.kind, design.id), [log.data, design.kind, design.id]);
  const last = useMemo(() => lastEditOf(log.data?.entries ?? [], design.kind, design.id), [log.data, design.kind, design.id]);
  return (
    <div data-testid="dh-timeline">
      {log.error ? <p className="an-alert" role="alert">{log.error}</p> : null}
      <p className="dh-last" data-testid="dh-last-editor">
        {log.loading && !log.data ? "読み込み中…" : last ? <>最後に編集したのは、<b>{last.actor}{last.via === "ai" ? " (AI)" : ""}</b> ({formatTime(last.at)}) です。</> : "この設計の変更の記録は、まだありません。"}
      </p>
      {entries.length > 0 && (
        <table className="an-table dh-table" data-testid="dh-timeline-table">
          <thead><tr><th>日時</th><th>利用者</th><th>操作</th></tr></thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={`${e.at}:${i}`}>
                <td style={{ whiteSpace: "nowrap" }}>{formatTime(e.at)}</td>
                <td>{e.actor}{e.via === "ai" ? <small className="an-hint"> (AI)</small> : null}</td>
                <td>{actionVerb(e.action)}{e.detail ? <small className="an-hint"> {e.detail}</small> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="an-hint">
        画面と AI からの保存・削除・改名の記録です。利用者名はブラウザごとの自己申告で、本人確認ではありません。記録は、このワークスペースの <code>.harmony-ops/</code> に残ります。
        {design.versionType ? <> 保存のたびに残る「保存前の版」とは、<button type="button" className="dh-link" onClick={onCompare}>「版を比べる」</button>で、中身の違いを見られます。</> : null}
      </p>
    </div>
  );
}
