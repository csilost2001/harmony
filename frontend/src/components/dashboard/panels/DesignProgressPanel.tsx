/**
 * 設計の完成度パネル。画面・処理フロー・テーブル・業務フロー・帳票の、下書き / 暫定 / 確定の件数 (種類別) と、確定の割合。
 * 表示したとき、その日の記録を残す (設計の分析の「進捗」で、推移として見られる)。
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MATURITY_LABELS, MATURITY_ORDER, summarizeProgress, type DesignDocInput } from "@harmony/shared";
import { useWorkspacePath } from "../../../hooks/useWorkspacePath";
import { mcpBridge } from "../../../mcp/mcpBridge";
import { loadDesignInput } from "../../document/loadDesignInput";

const RELOAD_EVENTS = ["projectChanged", "screenChanged", "processFlowChanged", "tableChanged", "businessFlowChanged", "reportChanged"] as const;
const COLOR = { draft: "var(--hm-fg-faint)", provisional: "var(--hm-warning)", committed: "var(--hm-success)" } as const;

export function DesignProgressPanel() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [input, setInput] = useState<DesignDocInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = async () => {
      try {
        const { input: i } = await loadDesignInput();
        if (cancelled) return;
        setInput(i); setError(null);
        // その日の記録を残す (記録できなくても、集計は出す)
        mcpBridge.request("design.progress", { record: true }).catch(() => undefined);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
    };
    const later = () => { clearTimeout(timer); timer = setTimeout(reload, 600); };
    void reload();
    const unsubs = RELOAD_EVENTS.map((ev) => mcpBridge.onBroadcast(ev, later));
    const unsubStatus = mcpBridge.onStatusChange((s) => { if (s === "connected") later(); });
    return () => { cancelled = true; clearTimeout(timer); unsubs.forEach((u) => u()); unsubStatus(); };
  }, []);

  const summary = useMemo(() => (input ? summarizeProgress(input) : null), [input]);
  if (error) return <div className="panel-error"><i className="bi bi-exclamation-triangle" /> 集計失敗: {error}</div>;
  if (!summary) return <div style={{ padding: 8, color: "var(--hm-fg-muted)" }}>集計中…</div>;
  const o = summary.overall;
  if (o.total === 0) return <div data-testid="design-progress-panel" style={{ padding: 8, color: "var(--hm-fg-muted)" }}>設計がまだないため、集計するものがありません。</div>;

  return (
    <div className="design-progress-panel" data-testid="design-progress-panel" style={{ padding: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: "1.5rem", fontWeight: 600 }} data-testid="design-progress-pct">{summary.committedPct}%</span>
        <span style={{ color: "var(--hm-fg-muted)", fontSize: "0.85rem" }}>確定 ({o.committed} / {o.total} 件)。残り {o.draft + o.provisional} 件</span>
      </div>
      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 4, fontSize: "0.82rem" }}>
        {summary.byKind.filter((k) => k.counts.total > 0).map((k) => (
          <li key={k.kind} style={{ display: "grid", gridTemplateColumns: "6.5em 1fr auto", gap: 8, alignItems: "center" }}>
            <span>{k.label}</span>
            <span style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", background: "var(--hm-surface-3)" }} role="img" aria-label={MATURITY_ORDER.map((m) => `${MATURITY_LABELS[m]} ${k.counts[m]} 件`).join("、")}>
              {MATURITY_ORDER.map((m) => k.counts[m] > 0 && <span key={m} style={{ width: `${(k.counts[m] / k.counts.total) * 100}%`, background: COLOR[m] }} />)}
            </span>
            <span style={{ color: "var(--hm-fg-muted)" }}>{k.counts.committed} / {k.counts.total}</span>
          </li>
        ))}
      </ul>
      <button type="button" className="dip-open" onClick={() => navigate(wsPath("/analysis"))} data-testid="design-progress-open">推移と、確定までの残りを見る</button>
    </div>
  );
}
