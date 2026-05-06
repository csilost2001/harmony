/**
 * 処理フロー成熟度パネル (#234)
 *
 * 全処理フロー (ProcessFlowMeta) の成熟度 (draft/provisional/committed) と付箋合計を集計。
 * クリックで処理フロー一覧画面へ遷移 (maturity フィルタ適用済み状態を想定、現状は単純遷移)。
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../../hooks/useWorkspacePath";
import type { ProcessFlowMeta } from "../../../types/action";
import { loadProject } from "../../../store/flowStore";
import { mcpBridge } from "../../../mcp/mcpBridge";

interface Summary {
  draft: number;
  provisional: number;
  committed: number;
  total: number;
  notes: number;
}

const INITIAL: Summary = { draft: 0, provisional: 0, committed: 0, total: 0, notes: 0 };

async function fetchSummary(): Promise<Summary> {
  const project = await loadProject();
  const groups = (project.processFlows ?? []) as ProcessFlowMeta[];
  const s: Summary = { ...INITIAL };
  for (const g of groups) {
    const m = g.maturity ?? "draft";
    if (m === "draft") s.draft++;
    else if (m === "provisional") s.provisional++;
    else s.committed++;
    s.total++;
    s.notes += g.notesCount ?? 0;
  }
  return s;
}

export function ProcessFlowMaturityPanel() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [summary, setSummary] = useState<Summary>(INITIAL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const reload = async () => {
      try {
        const s = await fetchSummary();
        if (!cancelled) { setSummary(s); setError(null); }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    reload();
    const unsubProject = mcpBridge.onBroadcast("projectChanged", reload);
    const unsubAction = mcpBridge.onBroadcast("processFlowChanged", reload);
    const unsubStatus = mcpBridge.onStatusChange((s) => { if (s === "connected") reload(); });
    return () => { cancelled = true; unsubProject(); unsubAction(); unsubStatus(); };
  }, []);

  const unfinished = summary.draft + summary.provisional;
  const progressPct = useMemo(() => {
    if (summary.total === 0) return 0;
    return Math.round((summary.committed / summary.total) * 100);
  }, [summary]);

  if (error) {
    return <div className="panel-error"><i className="bi bi-exclamation-triangle" /> 集計失敗: {error}</div>;
  }

  const go = () => navigate(wsPath("/process-flow/list"));

  return (
    <div className="process-flow-maturity-panel" style={{ padding: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
          {loading ? "…" : `${progressPct}%`}
        </div>
        <div style={{ color: "#64748b", fontSize: "0.85rem" }}>
          確定フロー率
        </div>
      </div>
      <div style={{ background: "#e2e8f0", borderRadius: 4, height: 8, marginTop: 6, overflow: "hidden" }}>
        <div style={{ background: "#22c55e", width: `${progressPct}%`, height: "100%", transition: "width 0.3s" }} />
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 10, fontSize: "0.85rem", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-sm btn-link p-0" onClick={go} style={{ color: "#22c55e", textDecoration: "none" }} title="一覧へ">
          <i className="bi bi-circle-fill me-1" />確定 {summary.committed}
        </button>
        <button type="button" className="btn btn-sm btn-link p-0" onClick={go} style={{ color: "#f97316", textDecoration: "none" }} title="一覧へ">
          <i className="bi bi-circle-fill me-1" />暫定 {summary.provisional}
        </button>
        <button type="button" className="btn btn-sm btn-link p-0" onClick={go} style={{ color: "#f59e0b", textDecoration: "none" }} title="一覧へ">
          <i className="bi bi-circle-fill me-1" />下書き {summary.draft}
        </button>
        {summary.notes > 0 && (
          <span className="text-muted" title={`付箋合計 ${summary.notes} 件`}>
            <i className="bi bi-sticky me-1" />付箋 {summary.notes}
          </span>
        )}
      </div>
      {unfinished > 0 && (
        <div style={{ marginTop: 8, fontSize: "0.8rem", color: "#f97316" }}>
          <i className="bi bi-exclamation-triangle me-1" />
          未確定: {unfinished} フロー (AI 実装前に committed へ昇格推奨)
        </div>
      )}
    </div>
  );
}
