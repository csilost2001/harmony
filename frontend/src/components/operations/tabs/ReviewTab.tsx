/** レビューと承認: 承認の状態の一覧・操作と、コメントのスレッドの一覧 */
import { useMemo, useState } from "react";
import { OPS_ENTITY_LABELS, STATUS_LABELS, type OpsEntityKind, type ApprovalStatus } from "@harmony/shared";
import { AnTable, EntityLink, Empty, Section } from "../../analysis/ui";
import { loadDesignInput } from "../../document/loadDesignInput";
import { opsApi } from "../../../utils/opsApi";
import { useLoad } from "../useLoad";
import { ApprovalControls, NewThread, StatusBadge, ThreadView } from "../reviewParts";
import { formatTime } from "../reviewUtils";

const KIND_LIST: Array<{ kind: OpsEntityKind; pick: (i: Awaited<ReturnType<typeof loadDesignInput>>["input"]) => Array<{ id: string; name: string }> }> = [
  { kind: "screen", pick: (i) => i.screens.filter((s) => s.purpose !== "gadget").map((s) => ({ id: s.id, name: s.name ?? s.id })) },
  { kind: "table", pick: (i) => i.tables.map((t) => ({ id: t.id, name: t.name ?? t.physicalName ?? t.id })) },
  { kind: "processFlow", pick: (i) => i.flows.map((f) => ({ id: f.meta.id, name: f.meta.name ?? f.meta.id })) },
  { kind: "businessFlow", pick: (i) => (i.businessFlows ?? []).map((b) => ({ id: b.id, name: b.name ?? b.id })) },
  { kind: "report", pick: (i) => (i.reports ?? []).map((r) => ({ id: r.id, name: r.name ?? r.id })) },
];

export function ReviewTab() {
  const approvals = useLoad(opsApi.approvalsLoad);
  const comments = useLoad(opsApi.commentsLoad);
  const design = useLoad(loadDesignInput, false);
  const [filter, setFilter] = useState<"all" | ApprovalStatus>("all");
  const [threadFilter, setThreadFilter] = useState<"open" | "resolved" | "all">("open");
  const [kind, setKind] = useState<OpsEntityKind>("table");
  const [pickId, setPickId] = useState("");

  const rows = approvals.data?.rows ?? [];
  const shown = filter === "all" ? rows : rows.filter((r) => r.status === filter);
  const options = useMemo(() => (design.data ? KIND_LIST.find((k) => k.kind === kind)?.pick(design.data.input) ?? [] : []), [design.data, kind]);
  const threads = (comments.data?.threads ?? []).filter((t) => threadFilter === "all" || t.status === threadFilter).sort((a, b) => b.messages.at(-1)!.at.localeCompare(a.messages.at(-1)!.at));
  const reloadAll = () => { approvals.reload(); comments.reload(); };
  const nameOf = (k: OpsEntityKind, id: string) => rows.find((r) => r.kind === k && r.id === id)?.name ?? KIND_LIST.find((x) => x.kind === k)?.pick(design.data?.input ?? { screens: [], tables: [], flows: [] } as never).find((x) => x.id === id)?.name ?? id;

  return (
    <div className="an-pane" data-testid="op-review">
      <Section title="承認" hint="設計ごとの、確定までの状態です。承認したあとに内容が変わると「承認後に変更」と表示します。「連携と運用」の「利用者と権限」で、確定に承認を必須にできます。" testId="op-approvals"
        actions={<select className="an-input" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="状態で絞る" data-testid="op-approval-filter"><option value="all">すべての状態</option>{(Object.keys(STATUS_LABELS) as ApprovalStatus[]).filter((s) => s !== "none").map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}</select>}>
        {approvals.error ? <p className="an-alert" role="alert">{approvals.error}</p> : null}
        {approvals.data?.problems.map((p) => <p key={p} className="an-alert" role="alert">{p}</p>)}
        <AnTable testId="op-approval-table" headers={["設計", "状態", "最後の操作", "操作"]} empty="承認の記録はまだありません。下の「承認を依頼する」から始めます。"
          rows={shown.map((r) => [
            <span key="n"><EntityLink kind={r.kind} id={r.id}>{r.name}</EntityLink> <small className="an-hint">{OPS_ENTITY_LABELS[r.kind]}</small></span>,
            <StatusBadge key="s" status={r.status} />,
            r.history.length ? <span key="h">{r.history.at(-1)!.by} <small>{formatTime(r.history.at(-1)!.at)}</small>{r.history.at(-1)!.note ? <small className="op-note"> 「{r.history.at(-1)!.note}」</small> : null}</span> : "",
            <ApprovalControls key="a" kind={r.kind} id={r.id} row={r} onChanged={reloadAll} />,
          ])} />
        <div className="an-form-row op-request" data-testid="op-request">
          <label>設計の種類<select className="an-input" value={kind} onChange={(e) => { setKind(e.target.value as OpsEntityKind); setPickId(""); }} data-testid="op-request-kind">{KIND_LIST.map((k) => <option key={k.kind} value={k.kind}>{OPS_ENTITY_LABELS[k.kind]}</option>)}</select></label>
          <label>設計<select className="an-input" value={pickId} onChange={(e) => setPickId(e.target.value)} data-testid="op-request-id"><option value="">(選ぶ)</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
          {pickId && <ApprovalControls kind={kind} id={pickId} row={rows.find((r) => r.kind === kind && r.id === pickId)} onChanged={reloadAll} />}
        </div>
      </Section>

      <Section title="レビューコメント" hint="設計の箇所に紐づく議論です。各設計の画面では、ヘッダーの「レビュー」から書けます。AI のレビューの指摘 (AI レビュー) もここに並びます。" testId="op-comments"
        actions={<select className="an-input" value={threadFilter} onChange={(e) => setThreadFilter(e.target.value as typeof threadFilter)} aria-label="コメントの状態" data-testid="op-thread-filter"><option value="open">未解決</option><option value="resolved">解決済み</option><option value="all">すべて</option></select>}>
        {comments.error ? <p className="an-alert" role="alert">{comments.error}</p> : null}
        {comments.data?.problems.map((p) => <p key={p} className="an-alert" role="alert">{p}</p>)}
        {threads.length === 0 ? <Empty>{threadFilter === "open" ? "未解決のコメントはありません。" : "コメントはありません。"}</Empty> : (
          <ul className="op-threads">
            {threads.map((t) => (
              <li key={t.id} className="op-thread-wrap">
                <div className="op-thread-target"><EntityLink kind={t.target.kind} id={t.target.id}>{nameOf(t.target.kind, t.target.id)}</EntityLink> <small className="an-hint">{OPS_ENTITY_LABELS[t.target.kind]}</small></div>
                <ul className="op-thread-list"><ThreadView thread={t} onChanged={reloadAll} /></ul>
              </li>
            ))}
          </ul>
        )}
        {pickId ? <NewThread kind={kind} id={pickId} onChanged={reloadAll} /> : <p className="an-hint">新しいコメントを書くには、上の「承認」の下で設計を選ぶか、各設計の画面のヘッダーの「レビュー」を使います。</p>}
      </Section>
    </div>
  );
}
