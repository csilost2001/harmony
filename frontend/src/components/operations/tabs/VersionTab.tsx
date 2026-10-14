/** 版と更新: アプリの版・コミット、リリースノート、更新の確認 */
import { useState } from "react";
import { Section } from "../../analysis/ui";
import { reportFailure } from "../../../utils/failureToast";
import { opsApi } from "../../../utils/opsApi";
import { markVersionSeen } from "../../../utils/updateNotice";
import { useLoad } from "../useLoad";

export function VersionTab() {
  const v = useLoad(opsApi.version, false);
  const [update, setUpdate] = useState<{ status: string; message: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const d = v.data;
  if (d) markVersionSeen(d);
  const check = async () => {
    setChecking(true);
    try { setUpdate(await opsApi.checkUpdate()); } catch (e) { reportFailure(e, "更新の確認"); } finally { setChecking(false); }
  };
  return (
    <div className="an-pane" data-testid="op-version">
      <Section title="版" testId="op-version-section" hint="いま動いている Harmony の版です。不具合の報告には、この表示 (版とコミット) を添えてください。">
        {v.error ? <p className="an-alert" role="alert">{v.error}</p> : null}
        {d && (
          <dl className="op-dl" data-testid="op-version-info">
            <dt>版</dt><dd>{d.version}</dd>
            <dt>コミット</dt><dd>{d.commit ? <><code>{d.commit}</code>{d.dirty ? " (コミットしていない変更あり)" : ""}{d.branch ? ` / ブランチ ${d.branch}` : ""}</> : "(git の作業コピーではありません)"}</dd>
            <dt>サーバの起動</dt><dd>{new Date(d.startedAt).toLocaleString("ja-JP")}</dd>
          </dl>
        )}
        <div className="an-row">
          <button type="button" className="an-btn" disabled={checking} onClick={() => void check()} data-testid="op-version-check"><i className="bi bi-arrow-repeat" /> 更新を確認する</button>
          <span className="an-hint">更新元 (origin) に、最新の main を問い合わせます (読み取りだけ。押したときだけ行います)。</span>
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
