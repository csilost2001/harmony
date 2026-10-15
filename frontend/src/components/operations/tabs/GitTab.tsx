/** Git 連携: 変更の確認・差分・コミット・ブランチの切り替え・履歴。push / pull / マージなど、リモートや履歴を書き換える操作はしない */
import { useState } from "react";
import { Section } from "../../analysis/ui";
import { reportFailure } from "../../../utils/failureToast";
import { opsApi } from "../../../utils/opsApi";
import { showToast } from "../../../utils/toast";
import { useLoad } from "../useLoad";
import { formatTime } from "../reviewUtils";

const STATUS_LABELS: Record<string, string> = { M: "変更", A: "追加", D: "削除", R: "改名", C: "コピー", "?": "未追跡", U: "競合" };

export function GitTab() {
  const status = useLoad(opsApi.gitStatus);
  const log = useLoad(() => opsApi.gitLog(20));
  const branches = useLoad(opsApi.gitBranches);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [diffOf, setDiffOf] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ diff: string; truncated: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [newBranch, setNewBranch] = useState("");
  const [confirmInit, setConfirmInit] = useState(false);
  const s = status.data;
  const reloadAll = () => { status.reload(); log.reload(); branches.reload(); };
  const run = async (what: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); if (done) showToast(done); reloadAll(); } catch (e) { reportFailure(e, what); } finally { setBusy(false); }
  };
  const toggle = (p: string) => setPicked((cur) => { const n = new Set(cur); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const files = s?.files ?? [];
  const chosen = files.filter((f) => picked.has(f.path)).map((f) => f.path);
  const showDiff = async (p: string) => {
    if (diffOf === p) { setDiffOf(null); setDiff(null); return; }
    setDiffOf(p); setDiff(null);
    try { setDiff(await opsApi.gitDiff(p)); } catch (e) { reportFailure(e, "差分の取得"); setDiffOf(null); }
  };

  return (
    <div className="an-pane" data-testid="op-git">
      <Section title="Git" testId="op-git-section"
        hint="ワークスペースの設計ファイルの変更を、確認してコミットします。push / pull / マージなど、リモートや履歴を書き換える操作は、git を直接使ってください。編集中で保存していない内容は、コミットされません。">
        {status.error ? <p className="an-alert" role="alert">{status.error}</p> : null}
        {s && !s.isRepo && (
          <div className="op-box" data-testid="op-git-norepo">
            <p>このワークスペースは、git のリポジトリではありません (上の階層のリポジトリに無視されている場合も含みます)。</p>
            {!confirmInit ? <button type="button" className="an-btn" onClick={() => setConfirmInit(true)} data-testid="op-git-init">git のリポジトリにする…</button> : (
              <span className="an-row">このフォルダで <code>git init</code> を実行します。よろしいですか?
                <button type="button" className="an-btn primary" disabled={busy} onClick={() => void run("git init", () => opsApi.gitInit(), "git のリポジトリにしました")} data-testid="op-git-init-go">実行する</button>
                <button type="button" className="an-btn" onClick={() => setConfirmInit(false)}>やめる</button></span>
            )}
          </div>
        )}
        {s?.isRepo && (
          <>
            {!s.ownRepo && <p className="an-hint">このワークスペースは、上の階層のリポジトリの一部です。このフォルダの中の変更だけを扱います。</p>}
            <div className="an-form-row op-branch">
              <span>ブランチ: <b data-testid="op-git-branch">{s.detached ? "(特定のコミット)" : s.branch ?? "(まだコミットがありません)"}</b></span>
              <label>切り替える<select className="an-input" value="" disabled={busy || !s.clean || !branches.data?.branches.length} onChange={(e) => { if (e.target.value) void run("ブランチの切り替え", () => opsApi.gitCheckout(e.target.value), "ブランチを切り替えました"); }} data-testid="op-git-switch"><option value="">(選ぶ)</option>{(branches.data?.branches ?? []).filter((b) => !b.current).map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}</select></label>
              <label>新しいブランチ<input className="an-input" value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="例: feature/order-review" data-testid="op-git-newbranch" /></label>
              <button type="button" className="an-btn" disabled={busy || !s.clean || !newBranch.trim()} onClick={() => void run("ブランチの作成", async () => { await opsApi.gitCheckout(newBranch.trim(), true); setNewBranch(""); }, "ブランチを作って切り替えました")} data-testid="op-git-create">作って切り替える</button>
              {!s.clean && <span className="an-hint">変更が残っているあいだは、切り替えられません (コミットしてください)。</span>}
            </div>

            <h3 className="op-h3">変更 ({files.length} 件)</h3>
            {files.length === 0 ? <p className="an-empty" data-testid="op-git-clean">変更はありません。</p> : (
              <>
                <div className="an-row"><button type="button" className="an-btn" onClick={() => setPicked(new Set(files.map((f) => f.path)))}>すべて選ぶ</button><button type="button" className="an-btn" onClick={() => setPicked(new Set())}>選びなおす</button></div>
                <table className="an-table" data-testid="op-git-files"><thead><tr><th scope="col"><span className="an-sr">選ぶ</span></th><th scope="col">状態</th><th scope="col">ファイル</th><th scope="col"><span className="an-sr">差分</span></th></tr></thead>
                  <tbody>
                    {files.map((f) => (
                      <tr key={f.path} data-testid="op-git-file">
                        <td><input type="checkbox" checked={picked.has(f.path)} onChange={() => toggle(f.path)} aria-label={`${f.path} をコミットに含める`} /></td>
                        <td>{STATUS_LABELS[f.status] ?? f.status}{f.staged ? <small className="an-hint"> (ステージ済み)</small> : null}</td>
                        <td><code>{f.path}</code></td>
                        <td><button type="button" className="an-btn" onClick={() => void showDiff(f.path)} aria-expanded={diffOf === f.path}>{diffOf === f.path ? "差分を閉じる" : "差分"}</button></td>
                      </tr>
                    ))}
                  </tbody></table>
                {diffOf && (
                  <pre className="an-code op-diff" data-testid="op-git-diff" aria-label={`${diffOf} の差分`}>{diff === null ? "読み込み中…" : diff.diff.split("\n").map((l, i) => <span key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "op-add" : l.startsWith("-") && !l.startsWith("---") ? "op-del" : l.startsWith("@@") ? "op-hunk" : ""}>{l}{"\n"}</span>)}{diff?.truncated ? "\n(長いため、途中まで表示しています)" : ""}</pre>
                )}
                {!s.identityConfigured && <p className="an-hint">git の利用者名・メールが設定されていません。コミットには、あなたの利用者名と harmony@localhost を使います。</p>}
                <label className="op-msg">コミットのメッセージ<textarea className="an-input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="例: 注文テーブルに配送先を追加" data-testid="op-git-message" /></label>
                <div className="an-row"><button type="button" className="an-btn primary" disabled={busy || !chosen.length || !message.trim()} data-testid="op-git-commit"
                  onClick={() => void run("コミット", async () => { await opsApi.gitCommit(message, chosen); setMessage(""); setPicked(new Set()); setDiffOf(null); }, `${chosen.length} ファイルをコミットしました`)}><i className="bi bi-check2-circle" /> 選んだ {chosen.length} 件をコミット</button></div>
              </>
            )}

            <h3 className="op-h3">履歴 (新しい 20 件)</h3>
            {(log.data?.commits ?? []).length === 0 ? <p className="an-empty">履歴はまだありません。</p> : (
              <table className="an-table" data-testid="op-git-log"><thead><tr><th scope="col">コミット</th><th scope="col">日時</th><th scope="col">作成者</th><th scope="col">メッセージ</th></tr></thead>
                <tbody>{log.data!.commits.map((c) => <tr key={c.hash}><td><code>{c.hash}</code></td><td style={{ whiteSpace: "nowrap" }}>{formatTime(c.at)}</td><td>{c.author}</td><td>{c.subject}</td></tr>)}</tbody></table>
            )}
          </>
        )}
      </Section>
    </div>
  );
}
