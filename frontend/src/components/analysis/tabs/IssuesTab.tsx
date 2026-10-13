/**
 * 要確認の管理。設計の要確認事項を一覧し、「意図どおり」のものを理由つきで抑制 (期限つきにもできる) する。
 * 抑制は design-check.json に残り、抑制中・期限切れ・該当がなくなったものを、ここで見直せる。
 */
import { useMemo, useState } from "react";
import { buildDesignDocument, issueKey, type DocIssue, type DesignDocInput, type IssueSuppression } from "@harmony/shared";
import { mcpBridge } from "../../../mcp/mcpBridge";
import { reportFailure } from "../../../utils/failureToast";
import { showToast } from "../../../utils/toast";
import { getUserName } from "../../../utils/userIdentity";
import { AnTable, EntityLink, Section, SeverityBadge } from "../ui";

const today = () => new Date().toISOString().slice(0, 10);

function IssueCell({ issue }: { issue: Pick<DocIssue, "section" | "ref"> }) {
  return issue.ref ? <EntityLink kind={issue.ref.kind} id={issue.ref.id}>{issue.section}</EntityLink> : <>{issue.section}</>;
}

export function IssuesTab({ input, skipped, reload }: { input: DesignDocInput; skipped: string[]; reload: () => void }) {
  const doc = useMemo(() => buildDesignDocument({ ...input, generatedAt: new Date().toISOString() }), [input]);
  const [sev, setSev] = useState<"all" | "error" | "warning" | "info">("all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [busy, setBusy] = useState(false);
  const status = doc.suppression;

  const shown = useMemo(() => doc.issues.filter((i) => (sev === "all" || i.severity === sev) && (!q || `${i.section} ${i.message}`.includes(q))), [doc.issues, sev, q]);
  const counts = { error: doc.issues.filter((i) => i.severity === "error").length, warning: doc.issues.filter((i) => i.severity === "warning").length, info: doc.issues.filter((i) => i.severity === "info").length };

  const run = async (what: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await fn(); showToast(done); reload(); } catch (e) { reportFailure(e, what); } finally { setBusy(false); }
  };

  const suppress = (i: DocIssue) => run("要確認の抑制", async () => {
    await mcpBridge.request("designCheck.suppress", { key: i.key ?? issueKey(i), reason, ...(expiresOn ? { expiresOn } : {}), by: getUserName() || undefined, severity: i.severity, section: i.section, message: i.message });
    setEditing(null); setReason(""); setExpiresOn("");
  }, "抑制しました");

  const unsuppress = (s: IssueSuppression) => run("抑制を外す", () => mcpBridge.request("designCheck.unsuppress", { key: s.key }), "抑制を外しました");
  const cleanup = () => run("抑制の整理", () => mcpBridge.request("designCheck.unsuppress", { keys: (status?.orphaned ?? []).map((s) => s.key) }), "整理しました");

  return (
    <div className="an-pane" data-testid="an-issues">
      {skipped.length > 0 && <p className="an-alert" role="alert"><i className="bi bi-exclamation-triangle" /> 読めないものがあるため、点検に含まれていません: {skipped.map((f) => <code key={f}>{f}</code>)}</p>}
      <Section title="要確認事項" hint="設計の抜け・矛盾の自動検査です。意図どおりのものは、理由を残して抑制できます。" testId="an-issues-list"
        actions={<>
          <select value={sev} onChange={(e) => setSev(e.target.value as typeof sev)} aria-label="重大度で絞る" className="an-input">
            <option value="all">すべて ({doc.issues.length})</option>
            <option value="error">エラー ({counts.error})</option>
            <option value="warning">警告 ({counts.warning})</option>
            <option value="info">情報 ({counts.info})</option>
          </select>
          <input type="search" className="an-input" placeholder="例: 顧客" aria-label="絞り込み" value={q} onChange={(e) => setQ(e.target.value)} />
        </>}>
        <AnTable testId="an-issues-table" headers={["重大度", "対象", "内容", ""]} empty="要確認事項はありません。" rows={shown.map((i) => {
          const key = i.key ?? issueKey(i);
          return [
            <SeverityBadge key="s" severity={i.severity} />,
            <IssueCell key="t" issue={i} />,
            <div key="m">
              {i.message}
              {editing === key && (
                <form className="an-suppress-form" onSubmit={(e) => { e.preventDefault(); void suppress(i); }}>
                  <label>抑制する理由 (必須)
                    <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required placeholder="例: ログアウトは誰でも実行できる操作のため" data-testid="an-suppress-reason" />
                  </label>
                  <label>期限 (任意。過ぎると、また出ます)
                    <input type="date" value={expiresOn} min={today()} onChange={(e) => setExpiresOn(e.target.value)} data-testid="an-suppress-expires" />
                  </label>
                  <span className="an-row">
                    <button type="submit" className="an-btn primary" disabled={busy || !reason.trim()} data-testid="an-suppress-submit">抑制する</button>
                    <button type="button" className="an-btn" onClick={() => setEditing(null)}>やめる</button>
                  </span>
                </form>
              )}
            </div>,
            editing === key ? "" : <button key="b" type="button" className="an-btn" onClick={() => { setEditing(key); setReason(""); setExpiresOn(""); }} data-testid="an-suppress-open">抑制…</button>,
          ];
        })} />
      </Section>

      <Section title={`抑制中 (${status?.suppressed.length ?? 0} 件)`} hint="理由つきで止めている要確認です。期限を過ぎると、要確認に戻ります。" testId="an-suppressed">
        <AnTable testId="an-suppressed-table" headers={["対象", "内容", "理由", "期限", "抑制した人 / 日時", ""]} empty="抑制している要確認はありません。" rows={(status?.suppressed ?? []).map(({ issue, suppression: s }) => [
          <IssueCell key="t" issue={issue} />, issue.message, s.reason, s.expiresOn ?? "なし", `${s.by ?? "不明"} / ${s.at.slice(0, 10)}`,
          <button key="b" type="button" className="an-btn" disabled={busy} onClick={() => void unsuppress(s)}>外す</button>,
        ])} />
      </Section>

      {(status?.expired.length ?? 0) > 0 && (
        <Section title={`期限が切れた抑制 (${status!.expired.length} 件)`} hint="要確認に戻っています。直すか、理由を見直して、もう一度抑制してください。" testId="an-expired">
          <AnTable headers={["対象", "内容", "前の理由", "期限", ""]} rows={status!.expired.map(({ issue, suppression: s }) => [
            <IssueCell key="t" issue={issue} />, issue.message, s.reason, s.expiresOn,
            <button key="b" type="button" className="an-btn" disabled={busy} onClick={() => void unsuppress(s)}>記録を消す</button>,
          ])} />
        </Section>
      )}

      {(status?.orphaned.length ?? 0) > 0 && (
        <Section title={`該当がなくなった抑制 (${status!.orphaned.length} 件)`} hint="直したか、内容が変わったため、止める対象が無くなっています。" testId="an-orphaned"
          actions={<button type="button" className="an-btn" disabled={busy} onClick={() => void cleanup()}>まとめて整理</button>}>
          <AnTable headers={["対象", "内容 (抑制した時点)", "理由", "期限"]} rows={status!.orphaned.map((s) => [s.section, s.message, s.reason, s.expiresOn ?? "なし"])} />
        </Section>
      )}
    </div>
  );
}
