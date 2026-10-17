/** 完了の確認 (#172): 要確認・命名規約・マーカー・レビューコメント・承認を、この設計について自動で判定する */
import { useEffect, useMemo, useState } from "react";
import { buildDesignDocument, type DocIssue } from "@harmony/shared";
import { mcpBridge } from "../../mcp/mcpBridge";
import { reportFailure } from "../../utils/failureToast";
import { checklistSummary, completionChecklist, type CheckStatus } from "../../utils/completionChecklist";
import type { TabDesign } from "../../utils/designHistory";
import type { MarkerItem } from "../../utils/markerOverview";
import { opsApi } from "../../utils/opsApi";
import { loadDesignInput } from "../document/loadDesignInput";

const ICON: Record<CheckStatus, string> = { ok: "bi-check-circle-fill", ng: "bi-x-circle-fill", unknown: "bi-question-circle" };
const ISSUE_KINDS = ["screen", "table", "processFlow", "businessFlow", "report"] as const;

interface Loaded { issues: DocIssue[] | null; markers: number; openThreads: number | null; approval: Parameters<typeof completionChecklist>[0]["approval"]; maturity?: string }

export function HistoryChecklistTab({ design }: { design: TabDesign }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const issueKind = (ISSUE_KINDS as readonly string[]).includes(design.kind) ? design.kind as (typeof ISSUE_KINDS)[number] : null;
      const [{ input }, markers, approvals, comments, current] = await Promise.all([
        issueKind ? loadDesignInput() : Promise.resolve({ input: null as never }),
        mcpBridge.request("listAllMarkers", { unresolvedOnly: true }) as Promise<{ items?: MarkerItem[] } | null>,
        design.opsKind ? opsApi.approvalsLoad() : Promise.resolve(null),
        design.opsKind ? opsApi.commentsLoad() : Promise.resolve(null),
        mcpBridge.request(design.load.method as never, { [design.load.key]: design.id } as never) as Promise<Record<string, unknown> | null>,
      ]);
      if (!alive) return;
      const issues = issueKind ? buildDesignDocument(input).issues.filter((i) => i.ref?.kind === issueKind && i.ref.id === design.id) : null;
      const row = approvals?.rows.find((r) => r.kind === design.opsKind && r.id === design.id);
      const meta = (current?.meta ?? null) as { maturity?: unknown } | null;
      const maturity = typeof current?.maturity === "string" ? current.maturity : typeof meta?.maturity === "string" ? meta.maturity : undefined;
      setData({
        issues,
        markers: (markers?.items ?? []).filter((m) => m.entityType === design.kind && m.entityId === design.id && !m.marker.resolvedAt).length,
        openThreads: comments ? comments.threads.filter((t) => t.status === "open" && t.target.kind === design.opsKind && t.target.id === design.id).length : null,
        approval: design.opsKind ? row?.status ?? "none" : null,
        maturity,
      });
    })().catch((e) => { if (alive) { setError(e instanceof Error ? e.message : String(e)); reportFailure(e, "完了の確認の読み込み"); } });
    return () => { alive = false; };
  }, [design]);

  const items = useMemo(() => (data ? completionChecklist({ issues: data.issues, unresolvedMarkers: data.markers, openThreads: data.openThreads, approval: data.approval, maturity: data.maturity }) : []), [data]);
  const sum = checklistSummary(items);
  if (error) return <p className="an-alert" role="alert">{error}</p>;
  if (!data) return <p className="an-hint">確かめています…</p>;
  return (
    <div data-testid="dh-checklist">
      <p className={`dh-verdict${sum.done ? " is-done" : ""}`} data-testid="dh-checklist-verdict">
        {sum.done ? <><i className="bi bi-patch-check-fill" /> 判定できる項目は、すべて満たしています。</> : <><i className="bi bi-hourglass-split" /> {sum.total} 項目のうち {sum.ok} 項目を満たしています。</>}
        {sum.unknown > 0 && <small className="an-hint"> (判定できない項目が {sum.unknown} 件あります)</small>}
      </p>
      <ul className="dh-checks">
        {items.map((it) => (
          <li key={it.id} className={`dh-check dh-check-${it.status}`} data-testid={`dh-check-${it.id}`} data-status={it.status}>
            <i className={`bi ${ICON[it.status]}`} aria-hidden="true" />
            <span className="dh-check-text"><b>{it.label}</b><small>{it.detail}</small></span>
            <span className="dh-check-state">{it.status === "ok" ? "満たしている" : it.status === "ng" ? "満たしていない" : "判定できない"}</span>
          </li>
        ))}
      </ul>
      <p className="an-hint">機械で分かる項目だけを判定します。設計の中身が正しいかは、判定しません。要確認は、設計の分析で人が理由つきで抑制したものを除いて数えます。</p>
    </div>
  );
}
