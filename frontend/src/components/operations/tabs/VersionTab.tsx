/** 版と更新: アプリの版・コミット、リリースノート、更新の確認 */
import { useState } from "react";
import { Section } from "../../analysis/ui";
import { reportFailure } from "../../../utils/failureToast";
import { opsApi, type ScaffoldSummary, type UpdateCheck } from "../../../utils/opsApi";
import { markVersionSeen } from "../../../utils/updateNotice";
import { useLoad } from "../useLoad";

export function VersionTab() {
  const v = useLoad(opsApi.version, false);
  const sc = useLoad(opsApi.scaffoldStatus);
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
    if (!d.branch) notices.push("この image を作ったときのブランチを特定できません (HEAD が特定のブランチにない状態など)。main の commit かどうかは「更新を確認する」で確かめられます。");
    else if (d.branch !== "main") notices.push(`この image は、main ではなくブランチ「${d.branch}」から作られています。最新の main の機能が入っていないことがあります。`);
    if (d.dirty) notices.push("この image は、コミットしていない変更がある状態で作られています。記録した commit と中身が一致しないことがあります。");
  }
  return (
    <div className="an-pane" data-testid="op-version">
      <Section title="版" testId="op-version-section" hint="いま動いている Harmony の版です。不具合の報告には、この表示 (版とコミット) を添えてください。">
        {v.error ? <p className="an-alert" role="alert">{v.error}</p> : null}
        {d && (
          <dl className="op-dl" data-testid="op-version-info">
            <dt>版</dt><dd>{d.version}</dd>
            {d.source === "image" && <><dt>種類</dt><dd data-testid="op-version-image">配布 image (git の作業コピーではありません)</dd></>}
            <dt>コミット</dt><dd>{d.commit ? <><code>{d.commit}</code>{d.dirty ? " (コミットしていない変更あり)" : ""}{d.branch ? ` / ブランチ ${d.branch}` : ""}</> : "(git の作業コピーではありません)"}</dd>
            {d.source === "image" && d.builtAt && <><dt>image を作った日時</dt><dd>{new Date(d.builtAt).toLocaleString("ja-JP")}</dd></>}
            {d.source === "image" && d.repo && <><dt>取得元</dt><dd>github.com/{d.repo}</dd></>}
            <dt>サーバの起動</dt><dd>{new Date(d.startedAt).toLocaleString("ja-JP")}</dd>
          </dl>
        )}
        {d && notices.map((n) => <p key={n} className="an-warn" role="note" data-testid="op-version-warn"><i className="bi bi-exclamation-triangle" /> {n}</p>)}
        <div className="an-row">
          <button type="button" className="an-btn" disabled={checking} onClick={() => void check()} data-testid="op-version-check"><i className="bi bi-arrow-repeat" /> 更新を確認する</button>
          <span className="an-hint">最新の main を問い合わせます (git の作業コピーは更新元 origin へ、配布 image は GitHub へ。読み取りだけ。押したときだけ行い、結果は 1 分ほど覚えます)。</span>
        </div>
        {update && <p className={update.status === "behind" ? "an-warn" : "an-hint"} role="status" data-testid="op-version-update">{update.message}</p>}
      </Section>
      <ScaffoldSection s={sc.data} error={sc.error} />
      <Section title="リリースノート" testId="op-release-notes" hint="取り込まれた変更の一覧です (docs/release-notes.md。npm run release:notes で、git の履歴から作ります)。">
        {d && d.notes.length === 0 ? <p className="an-empty">リリースノートはまだありません。</p> : (
          <ul className="op-notes">{(d?.notes ?? []).map((n, i) => <li key={i}><span className="op-note-date">{n.date}</span> {n.title}{n.pr ? <small className="an-hint"> #{n.pr}</small> : null}</li>)}</ul>
        )}
        {d && d.notesTotal > d.notes.length && <p className="an-hint">新しい {d.notes.length} 件を表示 (全 {d.notesTotal} 件)。</p>}
      </Section>
    </div>
  );
}

const SCAFFOLD_LABELS: Record<ScaffoldSummary["status"], string> = {
  current: "最新です",
  outdated: "雛形が新しくなっています",
  "no-record": "雛形の記録がありません",
  "not-applicable": "該当しません",
};

/** 開発コンテナの雛形 (generate-code の templates/devcontainer) の更新の状態。取り込みは AI に頼む (#1577) */
function ScaffoldSection({ s, error }: { s: ScaffoldSummary | null; error: string | null }) {
  const needsAction = s?.status === "outdated" || s?.status === "no-record";
  return (
    <Section title="開発コンテナの雛形" testId="op-scaffold" hint="コードを生成したときに写した、開発コンテナ (.devcontainer)・Dockerfile などの雛形が、Harmony の新しい雛形と食い違っていないかを見ます。">
      {error ? <p className="an-alert" role="alert">{error}</p> : null}
      {s && (
        <>
          <dl className="op-dl" data-testid="op-scaffold-info">
            <dt>状態</dt><dd data-testid="op-scaffold-status">{SCAFFOLD_LABELS[s.status]}</dd>
            {s.combo && <><dt>組合せ</dt><dd>{s.combo}</dd></>}
            {s.recordedVersion && <><dt>記録した版</dt><dd><code>{s.recordedVersion}</code></dd></>}
            {s.currentVersion && <><dt>いまの雛形の版</dt><dd><code>{s.currentVersion}</code></dd></>}
          </dl>
          {s.reason && s.status === "not-applicable" && <p className="an-hint" data-testid="op-scaffold-reason">{s.reason}</p>}
          {needsAction && (
            <p className="an-warn" role="note" data-testid="op-scaffold-ask"><i className="bi bi-info-circle" /> AI に「開発コンテナの雛形の更新を取り込んで」と頼んでください。AI が差分を見せるので、よければ OK と答えると取り込みます (取り込んだあとは Rebuild Container が要ります)。</p>
          )}
          {s.problems?.map((m) => <p key={m} className="an-alert" role="alert">{m}</p>)}
        </>
      )}
    </Section>
  );
}
