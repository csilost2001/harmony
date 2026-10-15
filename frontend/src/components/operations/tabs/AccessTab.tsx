/** 利用者と権限: 閲覧 / 編集 / 承認 / 管理の役割。誤操作・誤った承認を防ぐ運用上の区別で、本人確認ではない */
import { useState } from "react";
import { ROLES, ROLE_LABELS, type AccessFile, type Role } from "@harmony/shared";
import { Section } from "../../analysis/ui";
import { reportFailure } from "../../../utils/failureToast";
import { opsApi } from "../../../utils/opsApi";
import { showToast } from "../../../utils/toast";
import { getUserName } from "../../../utils/userIdentity";
import { useLoad } from "../useLoad";

type Loaded = Awaited<ReturnType<typeof opsApi.accessLoad>>;

export function AccessTab() {
  const load = useLoad(opsApi.accessLoad);
  const d = load.data;
  // 読み込んだ内容が変わったら、フォームを作り直す (編集中の状態を、読み込みの結果で上書きしないよう、初期値だけを渡す)
  return d ? <AccessForm key={JSON.stringify([d.access, d.problems, d.you])} d={d} error={load.error} reload={load.reload} /> : <div className="an-pane" data-testid="op-access">{load.error ? <p className="an-alert" role="alert">{load.error}</p> : <p className="an-empty">読み込み中…</p>}</div>;
}

function AccessForm({ d, error: loadError, reload }: { d: Loaded; error: string | null; reload: () => void }) {
  const load = { error: loadError, reload };
  const [users, setUsers] = useState<AccessFile["users"]>(d.access.users);
  const [policy, setPolicy] = useState<AccessFile["policy"]>(d.access.policy);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false); // 読めない項目を捨てて保存することの承知
  const blocked = d.problems.length > 0 && !discard;
  const me = getUserName();

  const save = async () => {
    setError(null);
    try { await opsApi.accessSave(users, policy, d.problems.length > 0); showToast("利用者と権限を保存しました"); setDirty(false); load.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); reportFailure(e, "利用者と権限の保存"); }
  };
  const edit = (fn: () => void) => { fn(); setDirty(true); };

  return (
    <div className="an-pane" data-testid="op-access">
      <Section title="利用者と権限" testId="op-access-section"
        hint="登録がなければ、これまでどおり誰でも編集・承認できます。登録すると、登録のない名前は「閲覧」になり、設計を変える操作は「編集」以上、承認は「承認」以上、この設定の変更は「管理」だけになります。">
        <p className="an-alert" role="note" data-testid="op-access-caution">利用者名は、ブラウザごとの自己申告です (本人確認ではありません)。誤操作・誤った承認を防ぐ区別として使います。なりすましを防ぐには、接続トークン (HARMONY_AUTH_TOKEN) とネットワークの制限を併用してください。AI (MCP) の権限は、環境変数 HARMONY_MCP_MODE / HARMONY_MCP_DENY で別に決めます。</p>
        {load.error ? <p className="an-alert" role="alert">{load.error}</p> : null}
        {d.problems.map((p) => <p key={p} className="an-alert" role="alert">{p}</p>)}
        {d.problems.length > 0 && (
          <label className="an-check" data-testid="op-access-discard">
            <input type="checkbox" checked={discard} onChange={(e) => setDiscard(e.target.checked)} data-testid="op-access-discard-check" /> 読めない項目 (上に出ている項目) を、捨てて保存することを承知しました。保存すると、それらの項目は消えます
          </label>
        )}
        <p className="an-hint" data-testid="op-access-you">いまのあなた: {d.you.name ? <b>{d.you.name}</b> : <b>利用者名が未設定</b>} {d.you.enforced ? `(役割: ${d.you.role ? ROLE_LABELS[d.you.role] : "登録なし = 閲覧"})` : "(権限の設定はまだありません: 制限なし)"}。利用者名は、画面右上の名前のボタンで変えられます。</p>
        <table className="an-table" data-testid="op-access-table">
          <thead><tr><th scope="col">利用者名</th><th scope="col">役割</th><th scope="col"><span className="an-sr">操作</span></th></tr></thead>
          <tbody>
            {users.map((u, i) => (
              <tr key={i}>
                <td><input className="an-input" value={u.name} aria-label="利用者名" onChange={(e) => edit(() => setUsers(users.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))))} /></td>
                <td><select className="an-input" value={u.role} aria-label="役割" onChange={(e) => edit(() => setUsers(users.map((x, j) => (j === i ? { ...x, role: e.target.value as Role } : x))))}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></td>
                <td><button type="button" className="an-btn" onClick={() => edit(() => setUsers(users.filter((_, j) => j !== i)))} aria-label={`${u.name || "この行"}を外す`}><i className="bi bi-trash" /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="an-row">
          <button type="button" className="an-btn" onClick={() => edit(() => setUsers([...users, { name: users.length === 0 && me ? me : "", role: users.length === 0 ? "admin" : "editor" }]))} data-testid="op-access-add"><i className="bi bi-plus-lg" /> 利用者を追加</button>
          {users.length === 0 && <span className="an-hint">最初の 1 人は「管理」にして、あなた自身 ({me || "利用者名を設定してください"}) を登録してください。</span>}
        </div>
        <label className="an-check"><input type="checkbox" checked={policy.requireApprovalForCommitted} onChange={(e) => edit(() => setPolicy({ requireApprovalForCommitted: e.target.checked }))} data-testid="op-access-policy" /> 確定 (成熟度「確定」) には、承認を必須にする (承認のない確定の保存を止めます。AI の書き込みも対象)</label>
        {error && <p className="an-alert" role="alert" data-testid="op-access-error">{error}</p>}
        <div className="an-row"><button type="button" className="an-btn primary" disabled={!dirty || blocked} onClick={() => void save()} data-testid="op-access-save">保存</button>
          <button type="button" className="an-btn" disabled={!dirty} onClick={() => { setUsers(d.access.users); setPolicy(d.access.policy); setDirty(false); }}>変更を捨てる</button></div>
      </Section>
    </div>
  );
}
