/**
 * ヘッダーの「レビュー」。いま開いている設計 (画面・テーブル・処理フロー・業務フロー・帳票など) の、承認の状態とコメントのスレッドを、その場で見て・書く。
 * 一覧・全体は「連携と運用」の「レビューと承認」。未解決のコメントの数を、印で知らせる。
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { OPS_ENTITY_LABELS, type OpsEntityKind } from "@harmony/shared";
import { useActiveTab } from "../../hooks/useActiveTab";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { opsApi } from "../../utils/opsApi";
import { onHeaderPanelRequest } from "../../utils/headerPanels";
import { useLoad } from "./useLoad";
import { ApprovalControls, NewThread, StatusBadge, ThreadView } from "./reviewParts";
import "../../styles/analysis.css";
import "../../styles/operations.css";

/** 設計のタブの種類 → 記録の対象の種類 */
const TAB_KIND: Record<string, OpsEntityKind> = {
  design: "screen", "screen-items": "screen", table: "table", "process-flow": "processFlow", "business-flow": "businessFlow", report: "report",
  sequence: "sequence", view: "view", "view-definition": "viewDefinition",
};

export function ReviewPanel() {
  const tab = useActiveTab();
  const kind = tab ? TAB_KIND[tab.type] : undefined;
  const id = tab?.resourceId;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const comments = useLoad(opsApi.commentsLoad, true, !!kind && !!id);
  const approvals = useLoad(opsApi.approvalsLoad, true, !!kind && !!id);

  useEffect(() => onHeaderPanelRequest("review", () => setOpen(true)), []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  if (!kind || !id) return null;

  const threads = (comments.data?.threads ?? []).filter((t) => t.target.kind === kind && t.target.id === id);
  const openThreads = threads.filter((t) => t.status === "open");
  const row = approvals.data?.rows.find((r) => r.kind === kind && r.id === id);
  const reload = () => { comments.reload(); approvals.reload(); };

  return (
    <span className="rv-wrap" ref={rootRef} onKeyDown={(e) => { if (open && e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" className="common-header-icon-btn" data-testid="review-open" title={`レビュー (承認とコメント)${openThreads.length ? ` — 未解決 ${openThreads.length} 件` : ""}`} aria-label={`レビュー${openThreads.length ? ` (未解決のコメント ${openThreads.length} 件)` : ""}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <i className="bi bi-chat-square-text" />
        {openThreads.length > 0 && <span className="rv-badge" aria-hidden="true" data-testid="review-badge">{openThreads.length}</span>}
      </button>
      {open && (
        <div className="rv-pop" role="dialog" aria-label="レビュー" data-testid="review-panel">
          <h2>{OPS_ENTITY_LABELS[kind]} <code>{id}</code> <StatusBadge status={row?.status ?? "none"} /></h2>
          <ApprovalControls kind={kind} id={id} row={row} onChanged={reload} />
          <h3>コメント ({openThreads.length} 件が未解決)</h3>
          {threads.length === 0 ? <p className="an-hint">この設計へのコメントは、まだありません。</p> : (
            <ul className="op-thread-list">{threads.map((t) => <ThreadView key={t.id} thread={t} onChanged={reload} compact />)}</ul>
          )}
          <NewThread kind={kind} id={id} onChanged={reload} />
          <button type="button" className="an-btn rv-more" onClick={() => { setOpen(false); navigate(wsPath("/operations")); }}>連携と運用を開く</button>
        </div>
      )}
    </span>
  );
}
