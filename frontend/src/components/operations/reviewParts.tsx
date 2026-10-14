/** レビューと承認の部品: 承認の操作・コメントのスレッド。連携と運用の画面と、ヘッダーのレビューパネルが共有する */
import { useState } from "react";
import { APPROVAL_LABELS, ROLE_LABELS, STATUS_LABELS, type ApprovalState, type CommentThread, type OpsEntityKind } from "@harmony/shared";
import { reportFailure } from "../../utils/failureToast";
import { opsApi, type ApprovalRow } from "../../utils/opsApi";
import { showToast } from "../../utils/toast";
import { formatTime as fmt } from "./reviewUtils";

const ACTION_LABELS: Record<ApprovalState, string> = { draft: "下書きに戻す", review: "承認を依頼", approved: "承認する", rejected: "差し戻す", };

export function StatusBadge({ status }: { status: ApprovalRow["status"] }) {
  return <span className={`op-status op-status-${status}`} data-testid="op-status">{STATUS_LABELS[status]}</span>;
}

/** 承認の操作ボタン (次に進める状態ごと)。差し戻しは理由を求める */
export function ApprovalControls({ kind, id, row, onChanged }: { kind: OpsEntityKind; id: string; row?: ApprovalRow; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const next: Array<{ to: ApprovalState; needs: string }> = row ? row.nextStates : [{ to: "review", needs: "editor" }];
  const go = async (to: ApprovalState, n?: string) => {
    setBusy(true);
    try { await opsApi.approvalTransition(kind, id, to, n); showToast(`「${APPROVAL_LABELS[to]}」にしました`); setRejecting(false); setNote(""); onChanged(); }
    catch (e) { reportFailure(e, "承認の操作"); } finally { setBusy(false); }
  };
  return (
    <span className="op-actions" data-testid="op-approval-controls">
      {next.map((n) => (
        <button key={n.to} type="button" className={`an-btn${n.to === "approved" ? " primary" : ""}`} disabled={busy} title={`必要な役割: ${ROLE_LABELS[n.needs as keyof typeof ROLE_LABELS] ?? n.needs}以上`}
          onClick={() => (n.to === "rejected" ? setRejecting(true) : void go(n.to))} data-testid={`op-approval-${n.to}`}>{ACTION_LABELS[n.to]}</button>
      ))}
      {rejecting && (
        <span className="op-reject">
          <input className="an-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 桁数が足りません" aria-label="差し戻しの理由" data-testid="op-reject-note" />
          <button type="button" className="an-btn danger" disabled={busy || !note.trim()} onClick={() => void go("rejected", note)} data-testid="op-reject-go">差し戻す</button>
          <button type="button" className="an-btn" onClick={() => setRejecting(false)}>やめる</button>
        </span>
      )}
    </span>
  );
}

/** コメントのスレッド 1 件 (返信・解決) */
export function ThreadView({ thread, onChanged, compact }: { thread: CommentThread; onChanged: () => void; compact?: boolean }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const resolved = thread.status === "resolved";
  const act = async (fn: () => Promise<unknown>, what: string) => { setBusy(true); try { await fn(); onChanged(); } catch (e) { reportFailure(e, what); } finally { setBusy(false); } };
  return (
    <li className={`op-thread${resolved ? " is-resolved" : ""}${thread.source === "ai-review" ? " is-ai" : ""}`} data-testid="op-thread">
      <div className="op-thread-head">
        {thread.source === "ai-review" && <span className="an-sev an-sev-info">AI レビュー</span>}
        {thread.severity && <span className={`an-sev an-sev-${thread.severity}`}>{{ error: "エラー", warning: "警告", info: "情報" }[thread.severity]}</span>}
        {thread.target.path && <code>{thread.target.path}</code>}
        <span className="an-spacer" />
        <span className="an-hint">{resolved ? `解決済み (${thread.resolvedBy ?? ""} ${thread.resolvedAt ? fmt(thread.resolvedAt) : ""})` : "未解決"}</span>
        <button type="button" className="an-btn" disabled={busy} onClick={() => void act(() => opsApi.commentResolve(thread.id, !resolved), "コメントの解決")} data-testid="op-thread-resolve">{resolved ? "開き直す" : "解決済みにする"}</button>
      </div>
      <ul className="op-msgs">
        {thread.messages.map((m) => (
          <li key={m.id}><b>{m.by}</b> <small>{fmt(m.at)}</small><p>{m.text}</p></li>
        ))}
      </ul>
      {!compact || !resolved ? (
        <div className="op-reply">
          <input className="an-input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="例: 20 桁にします" aria-label="返信" data-testid="op-reply-input"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && reply.trim()) { e.preventDefault(); void act(async () => { await opsApi.commentAdd({ threadId: thread.id, text: reply }); setReply(""); }, "コメントの返信"); } }} />
          <button type="button" className="an-btn" disabled={busy || !reply.trim()} onClick={() => void act(async () => { await opsApi.commentAdd({ threadId: thread.id, text: reply }); setReply(""); }, "コメントの返信")} data-testid="op-reply-send">返信</button>
        </div>
      ) : null}
    </li>
  );
}

/** 新しいスレッドを書く */
export function NewThread({ kind, id, onChanged }: { kind: OpsEntityKind; id: string; onChanged: () => void }) {
  const [text, setText] = useState("");
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { await opsApi.commentAdd({ target: { kind, id, ...(path.trim() ? { path: path.trim() } : {}) }, text }); setText(""); setPath(""); onChanged(); }
    catch (e) { reportFailure(e, "コメントの投稿"); } finally { setBusy(false); }
  };
  return (
    <div className="op-new-thread" data-testid="op-new-thread">
      <input className="an-input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="例: columns[2] (箇所。省略できます)" aria-label="コメントの箇所" data-testid="op-thread-path" />
      <textarea className="an-input" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="例: 桁数を確認してください" aria-label="コメント" data-testid="op-thread-text" />
      <button type="button" className="an-btn primary" disabled={busy || !text.trim()} onClick={() => void send()} data-testid="op-thread-send"><i className="bi bi-chat-left-text" /> コメントする</button>
    </div>
  );
}
