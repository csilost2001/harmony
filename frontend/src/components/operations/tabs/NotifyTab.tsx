/** 通知: Slack / Teams / 汎用の Webhook へ、承認・コメント・要確認の増加・コミットを知らせる。URL は秘密なので、画面にはホスト名だけを出す */
import { useState } from "react";
import { checkWebhookUrl, NOTIFY_EVENTS, NOTIFY_EVENT_LABELS, NOTIFY_FORMATS, NOTIFY_FORMAT_LABELS, type NotifyEvent, type NotifyFormat } from "@harmony/shared";
import { Section } from "../../analysis/ui";
import { reportFailure } from "../../../utils/failureToast";
import { opsApi, type WebhookInput, type WebhookView } from "../../../utils/opsApi";
import { showToast } from "../../../utils/toast";
import { useLoad } from "../useLoad";

interface Row extends WebhookInput { urlMasked?: string }

type Loaded = Awaited<ReturnType<typeof opsApi.notifyLoad>>;

export function NotifyTab() {
  const load = useLoad(opsApi.notifyLoad);
  const d = load.data;
  // 読み込んだ内容が変わったら、フォームを作り直す (編集中の状態を、読み込みの結果で上書きしないよう、初期値だけを渡す)
  return d ? <NotifyForm key={JSON.stringify(d)} d={d} error={load.error} reload={load.reload} /> : <div className="an-pane" data-testid="op-notify">{load.error ? <p className="an-alert" role="alert">{load.error}</p> : <p className="an-empty">読み込み中…</p>}</div>;
}

const toRows = (d: Loaded): Row[] => d.webhooks.map((w: WebhookView) => ({ id: w.id, name: w.name, format: w.format, events: w.events, enabled: w.enabled, urlMasked: w.urlMasked }));

function NotifyForm({ d, error: loadError, reload }: { d: Loaded; error: string | null; reload: () => void }) {
  const load = { error: loadError, reload };
  const [rows, setRows] = useState<Row[]>(() => toRows(d));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [confirmTest, setConfirmTest] = useState<string | null>(null);
  const edit = (i: number, patch: Partial<Row>) => { setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true); };

  const save = async () => {
    setError(null);
    try { await opsApi.notifySave(rows.map(({ urlMasked: _m, ...w }) => { void _m; return w; }), d.problems.length > 0); showToast("通知先を保存しました"); setDirty(false); load.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const test = async (id: string) => {
    setTesting(id);
    try { const r = await opsApi.notifyTest(id); showToast(r.ok ? "テストを送りました" : `送れませんでした: ${r.error ?? ""}`, r.ok ? "info" : "error"); }
    catch (e) { reportFailure(e, "通知のテスト"); } finally { setTesting(null); setConfirmTest(null); }
  };
  const urlProblem = (r: Row) => (r.url ? checkWebhookUrl(r.url) : null);

  return (
    <div className="an-pane" data-testid="op-notify">
      <Section title="通知" testId="op-notify-section" hint="設計の変更を、チャットに知らせます。送るのは、設計の名前・状態・件数などの短い文だけで、設計の中身そのものは送りません。接続先の URL は、このワークスペースの .harmony-ops/ にだけ保存し (git には載りません)、画面には出しません。">
        <p className="an-alert" role="note">送信先は https のみです。社内・ローカルのアドレス (127.0.0.1・10.x・192.168.x など) へは送れません。送信できるのは、利用者が登録した接続先だけで、AI (MCP) から送る・登録する手段はありません。</p>
        {load.error ? <p className="an-alert" role="alert">{load.error}</p> : null}
        {d.problems.map((p) => <p key={p} className="an-alert" role="alert">{p}</p>)}
        {rows.length === 0 ? <p className="an-empty">通知先はまだありません。</p> : (
          <ul className="op-hooks">
            {rows.map((r, i) => (
              <li key={r.id ?? i} className="op-hook" data-testid="op-hook">
                <div className="an-form-row">
                  <label>名前<input className="an-input" value={r.name} onChange={(e) => edit(i, { name: e.target.value })} placeholder="例: 設計チーム" data-testid="op-hook-name" /></label>
                  <label>形式<select className="an-input" value={r.format} onChange={(e) => edit(i, { format: e.target.value as NotifyFormat })}>{NOTIFY_FORMATS.map((f) => <option key={f} value={f}>{NOTIFY_FORMAT_LABELS[f]}</option>)}</select></label>
                  <label className="op-grow">接続先の URL {r.urlMasked && !r.url ? <small className="an-hint">(登録済み: {r.urlMasked}。変えるときだけ入力)</small> : null}
                    <input className="an-input" value={r.url ?? ""} onChange={(e) => edit(i, { url: e.target.value })} placeholder="例: https://hooks.slack.com/services/…" autoComplete="off" spellCheck={false} data-testid="op-hook-url" /></label>
                </div>
                {urlProblem(r) && <p className="an-alert" role="alert">{urlProblem(r)}</p>}
                <div className="an-row">
                  {NOTIFY_EVENTS.map((ev: NotifyEvent) => (
                    <label key={ev} className="an-check"><input type="checkbox" checked={r.events.includes(ev)} onChange={(e) => edit(i, { events: e.target.checked ? [...r.events, ev] : r.events.filter((x) => x !== ev) })} data-testid={`op-hook-event-${ev}`} /> {NOTIFY_EVENT_LABELS[ev]}</label>
                  ))}
                  <label className="an-check"><input type="checkbox" checked={r.enabled} onChange={(e) => edit(i, { enabled: e.target.checked })} /> 有効</label>
                  <span className="an-spacer" />
                  {confirmTest === r.id ? (
                    <span className="an-row">テスト用の文を、実際に外部へ送ります。
                      <button type="button" className="an-btn primary" disabled={testing === r.id} onClick={() => void test(r.id!)} data-testid="op-hook-test-go">送る</button>
                      <button type="button" className="an-btn" onClick={() => setConfirmTest(null)}>やめる</button></span>
                  ) : <button type="button" className="an-btn" disabled={dirty || !r.id || !r.urlMasked} title={dirty ? "先に保存してください" : "テスト用の文を送ります"} onClick={() => setConfirmTest(r.id!)} data-testid="op-hook-test">テスト送信…</button>}
                  <button type="button" className="an-btn" onClick={() => { setRows((x) => x.filter((_, j) => j !== i)); setDirty(true); }} aria-label={`${r.name || "この通知先"}を削除`}><i className="bi bi-trash" /></button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {error && <p className="an-alert" role="alert" data-testid="op-notify-error">{error}</p>}
        <div className="an-row">
          <button type="button" className="an-btn" onClick={() => { setRows((x) => [...x, { name: "", format: "slack", events: ["approval", "comment"], enabled: true, url: "" }]); setDirty(true); }} data-testid="op-hook-add"><i className="bi bi-plus-lg" /> 通知先を追加</button>
          <button type="button" className="an-btn primary" disabled={!dirty || rows.some((r) => !r.name.trim() || (!r.urlMasked && !r.url) || !!urlProblem(r))} onClick={() => void save()} data-testid="op-notify-save">保存</button>
          <button type="button" className="an-btn" disabled={!dirty} onClick={() => { setRows(toRows(d)); setDirty(false); }}>変更を捨てる</button>
        </div>
      </Section>
    </div>
  );
}
