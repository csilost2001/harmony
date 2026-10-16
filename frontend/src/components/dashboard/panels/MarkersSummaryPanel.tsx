/**
 * 未解決マーカー集計パネル (#261 / #1509)
 *
 * 全設計 (処理フロー・画面・テーブル・ビュー・ビュー定義・シーケンス・ページレイアウト) の未解決マーカーを集計する。
 * 種類別の件数・設計ごとの件数・いちばん古い未解決の経過日数・新しい 5 件。クリックで、その設計の編集画面 / マーカー一覧へ。
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MARKER_ENTITY_LABELS } from "@harmony/shared";
import { useWorkspacePath } from "../../../hooks/useWorkspacePath";
import type { MarkerKind } from "../../../types/v3";
import { mcpBridge } from "../../../mcp/mcpBridge";
import { markerEntityRoute, summarizeMarkerItems, ageDays, type MarkerItem } from "../../../utils/markerOverview";

const KIND_LABEL: Record<MarkerKind, string> = {
  chat: "チャット",
  attention: "注目",
  todo: "TODO",
  question: "質問",
  validator: "validator", // 古い原本に残るものの移行用 (新しくは書かれない)
};
const KIND_COLOR: Record<MarkerKind, string> = {
  chat: "var(--hm-hue-blue)",
  attention: "var(--hm-hue-amber)",
  todo: "var(--hm-hue-green)",
  question: "var(--hm-hue-purple)",
  validator: "var(--hm-danger)",
};

const CHANGE_EVENTS = ["projectChanged", "processFlowChanged", "screenChanged", "tableChanged", "viewChanged", "viewDefinitionChanged", "sequenceChanged", "pageLayoutChanged"];

export function MarkersSummaryPanel() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [items, setItems] = useState<MarkerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 全設計を、1 回の問い合わせでまとめて読む (1 件ずつ尋ねると、件数だけ往復する)
    const reload = async () => {
      try {
        const r = await mcpBridge.request("listAllMarkers", { unresolvedOnly: true }) as { items?: MarkerItem[] } | null;
        if (!cancelled) { setItems(r?.items ?? []); setError(null); }
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const later = () => { clearTimeout(timer); timer = setTimeout(reload, 300); };
    void reload();
    const unsubs = CHANGE_EVENTS.map((ev) => mcpBridge.onBroadcast(ev, later));
    const unsubStatus = mcpBridge.onStatusChange((s) => { if (s === "connected") void reload(); });
    return () => { cancelled = true; clearTimeout(timer); unsubs.forEach((u) => u()); unsubStatus(); };
  }, []);

  if (error) return <div className="panel-error"><i className="bi bi-exclamation-triangle" /> 集計失敗: {error}</div>;

  const summary = summarizeMarkerItems(items);
  const open = (type: MarkerItem["entityType"], id: string) => navigate(wsPath(markerEntityRoute(type, id)));

  return (
    <div className="markers-summary-panel" style={{ padding: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: "1.5rem", fontWeight: 600 }} data-testid="markers-summary-total">
          {loading ? "…" : summary.total}
        </div>
        <div style={{ color: "var(--hm-fg-muted)", fontSize: "0.85rem" }}>未解決マーカー (AI 依頼)</div>
        {summary.total > 0 && (
          <span style={{ color: summary.oldestDays >= 7 ? "var(--hm-warning)" : "var(--hm-fg-muted)", fontSize: "0.78rem" }} title="いちばん古い未解決マーカーが、付けられてからの日数" data-testid="markers-summary-oldest">
            最長 {summary.oldestDays} 日
          </span>
        )}
        <button type="button" className="btn btn-sm btn-link p-0 ms-auto" onClick={() => navigate(wsPath("/markers"))} data-testid="markers-summary-all">すべて見る</button>
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
      {summary.byType.length > 1 && (
        <div style={{ marginTop: 6, fontSize: "0.75rem", color: "var(--hm-fg-muted)" }}>
          {summary.byType.map((t) => `${t.label} ${t.count}`).join(" ・ ")}
        </div>
      )}
      {summary.perEntity.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, marginTop: 8, fontSize: "0.82rem" }}>
          {summary.perEntity.slice(0, 5).map((g) => (
            <li key={`${g.type}:${g.id}`} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
              <button type="button" className="btn btn-sm btn-link p-0" onClick={() => open(g.type, g.id)}
                style={{ textAlign: "left", flex: 1, textDecoration: "none", color: "var(--hm-fg-2)" }} title="編集画面を開く">
                {g.name}<small style={{ color: "var(--hm-fg-faint)", marginLeft: 6 }}>{MARKER_ENTITY_LABELS[g.type]}</small>
              </button>
              <span style={{ color: "color-mix(in srgb, var(--hm-hue-orange) 80%, var(--hm-fg))", fontWeight: 600, marginLeft: 8 }}>{g.count}</span>
            </li>
          ))}
          {summary.perEntity.length > 5 && (
            <li style={{ fontSize: "0.75rem", color: "var(--hm-fg-faint)", padding: "2px 0" }}>他 {summary.perEntity.length - 5} 件の設計</li>
          )}
        </ul>
      )}
      {summary.recent.length > 0 && (
        <div style={{ marginTop: 10, borderTop: "1px solid var(--hm-border)", paddingTop: 6 }}>
          <div style={{ fontSize: "0.72rem", color: "var(--hm-fg-faint)", marginBottom: 4, fontWeight: 600 }}>最新マーカー</div>
          <ul className="markers-recent-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {summary.recent.map((i) => (
              <li key={`${i.entityType}:${i.entityId}:${i.marker.id}`} className="markers-recent-item" style={{ padding: "4px 0", borderBottom: "1px dotted var(--hm-border)", fontSize: "0.78rem" }}>
                <button type="button" className="btn btn-sm btn-link p-0 markers-recent-btn" onClick={() => open(i.entityType, i.entityId)}
                  style={{ textAlign: "left", width: "100%", textDecoration: "none" }}
                  title={`${i.entityName} — ${new Date(i.marker.createdAt).toLocaleString("ja-JP")} (${ageDays(i.marker.createdAt)} 日前)`}>
                  <span style={{ color: KIND_COLOR[i.marker.kind], fontWeight: 600, marginRight: 4 }}>
                    <i className="bi bi-circle-fill" style={{ fontSize: "0.5rem", marginRight: 3 }} />
                    {KIND_LABEL[i.marker.kind]}
                  </span>
                  <span style={{ color: "var(--hm-fg-2)" }}>
                    {i.marker.body.length > 50 ? `${i.marker.body.slice(0, 50)}…` : i.marker.body}
                  </span>
                  <div style={{ color: "var(--hm-fg-faint)", fontSize: "0.7rem" }}>
                    <i className="bi bi-diagram-3 me-1" />{i.entityName} ({MARKER_ENTITY_LABELS[i.entityType]})
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!loading && summary.total === 0 && (
        <div style={{ marginTop: 8, color: "var(--hm-fg-faint)", fontSize: "0.8rem" }}>
          未解決のマーカーはありません。設計の編集画面の「マーカー」から、AI への指示・質問を付けられます。
        </div>
      )}
    </div>
  );
}
