// @ts-nocheck
/**
 * 未解決マーカー集計パネル (#261)
 *
 * 全 ProcessFlow を走査して、未解決 marker の件数を kind 別に集計。
 * クリックで処理フロー一覧 (未解決 marker 有りでフィルタする想定、現状は単純遷移)。
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ProcessFlow, MarkerKind } from "../../../types/action";
import { listProcessFlows, loadProcessFlow } from "../../../store/processFlowStore";
import { mcpBridge } from "../../../mcp/mcpBridge";

interface RecentMarker {
  id: string;
  kind: MarkerKind;
  body: string;
  createdAt: string;
  processFlowId: string;
  processFlowName: string;
}

interface Summary {
  total: number;
  byKind: Record<MarkerKind, number>;
  perGroup: Array<{ id: string; name: string; count: number }>;
  recent: RecentMarker[];
}

const INITIAL: Summary = {
  total: 0,
  byKind: { chat: 0, attention: 0, todo: 0, question: 0 },
  perGroup: [],
  recent: [],
};

async function fetchSummary(): Promise<Summary> {
  const metas = await listProcessFlows();
  const s: Summary = { total: 0, byKind: { chat: 0, attention: 0, todo: 0, question: 0 }, perGroup: [], recent: [] };
  for (const meta of metas) {
    const g: ProcessFlow | null = await loadProcessFlow(meta.id);
    if (!g) continue;
    const unresolved = (g.markers ?? []).filter((m) => !m.resolvedAt);
    if (unresolved.length === 0) continue;
    for (const m of unresolved) {
      s.byKind[m.kind] = (s.byKind[m.kind] ?? 0) + 1;
      s.total++;
      s.recent.push({
        id: m.id,
        kind: m.kind,
        body: m.body,
        createdAt: m.createdAt,
        processFlowId: g.id,
        processFlowName: g.name,
      });
    }
    s.perGroup.push({ id: g.id, name: g.name, count: unresolved.length });
  }
  s.perGroup.sort((a, b) => b.count - a.count);
  // 新しい順 (desc)
  s.recent.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  s.recent = s.recent.slice(0, 5);
  return s;
}

const KIND_LABEL: Record<MarkerKind, string> = {
  chat: "チャット",
  attention: "注目",
  todo: "TODO",
  question: "質問",
};
const KIND_COLOR: Record<MarkerKind, string> = {
  chat: "#3b82f6",
  attention: "#f59e0b",
  todo: "#10b981",
  question: "#8b5cf6",
};

export function MarkersSummaryPanel() {
  const navigate = useNavigate();
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

  if (error) return <div className="panel-error"><i className="bi bi-exclamation-triangle" /> 集計失敗: {error}</div>;

  return (
    <div className="markers-summary-panel" style={{ padding: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 600 }}>
          {loading ? "…" : summary.total}
        </div>
        <div style={{ color: "#64748b", fontSize: "0.85rem" }}>未解決マーカー (AI 依頼)</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, fontSize: "0.78rem", flexWrap: "wrap" }}>
        {(Object.keys(summary.byKind) as MarkerKind[]).map((k) => {
          const count = summary.byKind[k];
          if (count === 0) return null;
          return (
            <span key={k} style={{ color: KIND_COLOR[k], fontWeight: 500 }}>
              <i className="bi bi-circle-fill me-1" />{KIND_LABEL[k]} {count}
            </span>
          );
        })}
      </div>
      {summary.perGroup.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, marginTop: 8, fontSize: "0.82rem" }}>
          {summary.perGroup.slice(0, 5).map((g) => (
            <li key={g.id} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
              <button
                type="button"
                className="btn btn-sm btn-link p-0"
                onClick={() => navigate(`/process-flow/edit/${g.id}`)}
                style={{ textAlign: "left", flex: 1, textDecoration: "none", color: "#334155" }}
                title="エディタを開く"
              >
                {g.name}
              </button>
              <span style={{ color: "#f97316", fontWeight: 600, marginLeft: 8 }}>{g.count}</span>
            </li>
          ))}
          {summary.perGroup.length > 5 && (
            <li style={{ fontSize: "0.75rem", color: "#94a3b8", padding: "2px 0" }}>
              他 {summary.perGroup.length - 5} フロー
            </li>
          )}
        </ul>
      )}
      {summary.recent.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "1px solid #e2e8f0", paddingTop: 6 }}>
          <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginBottom: 4, fontWeight: 600 }}>最新マーカー</div>
          <ul className="markers-recent-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {summary.recent.map((m) => (
              <li
                key={m.id}
                className="markers-recent-item"
                style={{ padding: "4px 0", borderBottom: "1px dotted #f1f5f9", fontSize: "0.78rem" }}
              >
                <button
                  type="button"
                  className="btn btn-sm btn-link p-0 markers-recent-btn"
                  onClick={() => navigate(`/process-flow/edit/${m.processFlowId}`)}
                  style={{ textAlign: "left", width: "100%", textDecoration: "none" }}
                  title={`${m.processFlowName} — ${new Date(m.createdAt).toLocaleString("ja-JP")}`}
                >
                  <span style={{ color: KIND_COLOR[m.kind], fontWeight: 600, marginRight: 4 }}>
                    <i className="bi bi-circle-fill" style={{ fontSize: "0.5rem", marginRight: 3 }} />
                    {KIND_LABEL[m.kind]}
                  </span>
                  <span style={{ color: "#334155" }}>
                    {m.body.length > 50 ? `${m.body.slice(0, 50)}…` : m.body}
                  </span>
                  <div style={{ color: "#94a3b8", fontSize: "0.7rem" }}>
                    <i className="bi bi-diagram-3 me-1" />{m.processFlowName}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {summary.total === 0 && !loading && (
        <div style={{ marginTop: 6, color: "#94a3b8", fontSize: "0.8rem" }}>
          未解決のマーカーはありません
        </div>
      )}
    </div>
  );
}
