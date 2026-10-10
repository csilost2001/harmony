/**
 * 設計の要確認パネル。設計書の「要確認事項」(画面の部品・業務フロー・帳票・権限・CRUD 等の自動検査)
 * の件数と、エラー・警告の上位を出す。クリックで設計書へ移動。`npm run check:design` と同じ検査。
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildDesignDocument, type DocIssue } from "@harmony/shared";
import { useWorkspacePath } from "../../../hooks/useWorkspacePath";
import { mcpBridge } from "../../../mcp/mcpBridge";
import { loadDesignInput } from "../../document/loadDesignInput";

const SHOWN = 6;
const RELOAD_EVENTS = [
  "projectChanged", "screenChanged", "screenItemsChanged", "processFlowChanged", "tableChanged", "businessFlowChanged", "reportChanged", "layoutComponentsChanged",
] as const;

const SEV_ICON: Record<DocIssue["severity"], string> = { error: "bi-x-octagon-fill", warning: "bi-exclamation-triangle-fill", info: "bi-info-circle" };
const SEV_COLOR: Record<DocIssue["severity"], string> = { error: "var(--hm-danger)", warning: "var(--hm-warning)", info: "var(--hm-fg-muted)" };

export function DesignIssuesPanel() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [issues, setIssues] = useState<DocIssue[] | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [empty, setEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = async () => {
      try {
        const { input, skipped: sk } = await loadDesignInput();
        const doc = buildDesignDocument(input);
        if (!cancelled) {
          setIssues(doc.issues); setSkipped(sk); setError(null);
          setEmpty(input.screens.length + input.flows.length + input.tables.length + (input.businessFlows?.length ?? 0) + (input.reports?.length ?? 0) === 0);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    // 保存が続けて起きても、読み直しは 1 回にまとめる
    const later = () => { clearTimeout(timer); timer = setTimeout(reload, 400); };
    reload();
    const unsubs = RELOAD_EVENTS.map((ev) => mcpBridge.onBroadcast(ev, later));
    const unsubStatus = mcpBridge.onStatusChange((s) => { if (s === "connected") later(); });
    return () => { cancelled = true; clearTimeout(timer); unsubs.forEach((u) => u()); unsubStatus(); };
  }, []);

  const counts = useMemo(() => ({
    error: (issues ?? []).filter((i) => i.severity === "error").length + skipped.length,
    warning: (issues ?? []).filter((i) => i.severity === "warning").length,
    info: (issues ?? []).filter((i) => i.severity === "info").length,
  }), [issues, skipped]);

  const top = useMemo(() => {
    const order = { error: 0, warning: 1, info: 2 } as const;
    return (issues ?? []).filter((i) => i.severity !== "info").sort((a, b) => order[a.severity] - order[b.severity]).slice(0, SHOWN);
  }, [issues]);

  if (error) return <div className="panel-error"><i className="bi bi-exclamation-triangle" /> 検査失敗: {error}</div>;
  if (!issues) return <div style={{ padding: 8, color: "var(--hm-fg-muted)" }}>検査中…</div>;

  if (empty && skipped.length === 0) return <div className="design-issues-panel" data-testid="design-issues-panel" style={{ padding: 8, color: "var(--hm-fg-muted)" }}>設計がまだないため、検査するものがありません。</div>;

  const go = () => navigate(wsPath("/document"));
  const clean = counts.error === 0 && counts.warning === 0;

  return (
    <div className="design-issues-panel" data-testid="design-issues-panel" style={{ padding: 8 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
        {clean
          ? <span style={{ color: "var(--hm-success)", fontWeight: 600 }}><i className="bi bi-check-circle-fill me-1" />エラー・警告はありません</span>
          : <>
              <span data-testid="design-issues-error" style={{ color: SEV_COLOR.error, fontWeight: 600 }}><i className={`bi ${SEV_ICON.error} me-1`} />エラー {counts.error}</span>
              <span data-testid="design-issues-warning" style={{ color: SEV_COLOR.warning, fontWeight: 600 }}><i className={`bi ${SEV_ICON.warning} me-1`} />警告 {counts.warning}</span>
            </>}
        <span style={{ color: "var(--hm-fg-muted)", fontSize: "0.85rem" }}>情報 {counts.info}</span>
      </div>
      {skipped.length > 0 && (
        <div style={{ marginTop: 6, fontSize: "0.8rem", color: SEV_COLOR.error }}>
          <i className="bi bi-file-earmark-x me-1" />読めないもの: {skipped.join(", ")}
        </div>
      )}
      {top.length > 0 && (
        <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, fontSize: "0.82rem" }}>
          {top.map((i, k) => (
            <li key={k} style={{ display: "flex", gap: 6, padding: "2px 0" }}>
              <i className={`bi ${SEV_ICON[i.severity]}`} style={{ color: SEV_COLOR[i.severity], marginTop: 2 }} />
              <span><b>{i.section}</b>: {i.message}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="dip-open" onClick={go} data-testid="design-issues-open">
        設計書で全件を見る{counts.error + counts.warning > SHOWN ? ` (ほか ${counts.error + counts.warning - SHOWN} 件)` : ""}
      </button>
    </div>
  );
}
