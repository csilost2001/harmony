/** 版と更新: アプリの版・コミット、リリースノート、更新の確認 */
import { useState } from "react";
import { Section } from "../../analysis/ui";
import { reportFailure } from "../../../utils/failureToast";
import { opsApi, type UpdateCheck } from "../../../utils/opsApi";
import { markVersionSeen } from "../../../utils/updateNotice";
import { useLoad } from "../useLoad";

export function VersionTab() {
  const v = useLoad(opsApi.version, false);
  const [update, setUpdate] = useState<UpdateCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const d = v.data;
  if (d) markVersionSeen(d);
  const check = async () => {
    setChecking(true);
    try { setUpdate(await opsApi.checkUpdate()); } catch (e) { reportFailure(e, "更新の確認"); } finally { setChecking(false); }
  };
  // 配布 image が、main 以外のブランチや、コミットしていない変更から作られたものだと、利用者が気づけるように知らせる (#1577)
  const notices: string[] = [];
  if (d?.source === "image") {
    if (d.branch && d.branch !== "main") notices.push(`この image は、main ではなくブランチ「${d.branch}」から作られています。最新の main の機能が入っていないことがあります。`);
    if (d.dirty) notices.push("この image は、コミットしていない変更がある状態で作られています。記録した commit と中身が一致しないことがあります。");
  }
  return (
    <div className="an-pane" data-testid="op-version">
      <Section title="版" testId="op-version-section" hint="いま動いている Harmony の版です。不具合の報告には、この表示 (版とコミット) を添えてください。">
        {v.error ? <p className="an-alert" role="alert">{v.error}</p> : null}
        {d && (
          <dl className="op-dl" data-testid="op-version-info">
            <dt>版</dt><dd>{d.version}</dd>
            {d.source === "image" && <><dt>配布</dt><dd data-testid="op-version-image">配布 image</dd></>}
            <dt>コミット</dt><dd>{d.commit ? <><code>{d.commit}</code>{d.dirty ? " (コミットしていない変更あり)" : ""}{d.branch ? ` / ブランチ ${d.branch}` : ""}</> : "(git の作業コピーではありません)"}</dd>
            {d.source === "image" && d.builtAt && <><dt>image を作った日時</dt><dd>{new Date(d.builtAt).toLocaleString("ja-JP")}</dd></>}
            {d.source === "image" && d.repo && <><dt>取得元</dt><dd>github.com/{d.repo}</dd></>}
            <dt>サーバの起動</dt><dd>{new Date(d.startedAt).toLocaleString("ja-JP")}</dd>
          </dl>
        )}
        {d && notices.map((n) => <p key={n} className="an-warn" role="note" data-testid="op-version-warn"><i className="bi bi-exclamation-triangle" /> {n}</p>)}
        <div className="an-row">
          <button type="button" className="an-btn" disabled={checking} onClick={() => void check()} data-testid="op-version-check"><i className="bi bi-arrow-repeat" /> 更新を確認する</button>
          <span className="an-hint">最新の main を問い合わせます (git の作業コピーは更新元 origin へ、配布 image は GitHub へ。読み取りだけ。押したときだけ行います)。</span>
        </div>
        {update && <p className={update.status === "behind" ? "an-warn" : "an-hint"} role="status" data-testid="op-version-update">{update.message}</p>}
      </Section>
      <Section title="リリースノート" testId="op-release-notes" hint="取り込まれた変更の一覧です (docs/release-notes.md。npm run release:notes で、git の履歴から作ります)。">
        {d && d.notes.length === 0 ? <p className="an-empty">リリースノートはまだありません。</p> : (
          <ul className="op-notes">{(d?.notes ?? []).map((n, i) => <li key={i}><span className="op-note-date">{n.date}</span> {n.title}{n.pr ? <small className="an-hint"> #{n.pr}</small> : null}</li>)}</ul>
        )}
        {d && d.notesTotal > d.notes.length && <p className="an-hint">新しい {d.notes.length} 件を表示 (全 {d.notesTotal} 件)。</p>}
      </Section>
    </div>
  );
}
