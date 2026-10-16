/**
 * 今日やること (UI 改善提案 続編 第 6 弾 #116)。未保存の下書き・要確認のエラー・未解決のマーカー・要確認の警告を 1 本の列にして、
 * 「次へ」で 1 つずつ開いて直していく。直して戻ると、次のものが先頭に来る。
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { buildDesignDocument, type DocIssue } from "@harmony/shared";
import { useWorkspacePath } from "../../../hooks/useWorkspacePath";
import { mcpBridge } from "../../../mcp/mcpBridge";
import { loadDesignInput } from "../../document/loadDesignInput";
import { listAllDrafts } from "../../../utils/draftStorage";
import type { MarkerItem } from "../../../utils/markerOverview";
import { buildTodayTasks, TODAY_KIND_LABELS, type TodayKind } from "../../../utils/todayTasks";
import { loadNotes } from "../../../utils/personalNotes";

const RELOAD_EVENTS = ["projectChanged", "screenChanged", "screenItemsChanged", "processFlowChanged", "tableChanged", "businessFlowChanged", "reportChanged", "designCheckChanged", "viewChanged", "viewDefinitionChanged", "sequenceChanged", "pageLayoutChanged"] as const;
const KIND_ICON: Record<TodayKind, string> = { draft: "bi-hourglass-split", note: "bi-journal-text", error: "bi-x-octagon-fill", marker: "bi-megaphone", warning: "bi-exclamation-triangle-fill" };
const KIND_COLOR: Record<TodayKind, string> = { draft: "var(--hm-hue-amber)", note: "var(--hm-hue-blue)", error: "var(--hm-danger)", marker: "var(--hm-hue-purple)", warning: "var(--hm-warning)" };
const SHOWN = 5;

export function TodayPanel() {
  const navigate = useNavigate();
  const { wsPath, wsId } = useWorkspacePath();
  const [issues, setIssues] = useState<DocIssue[]>([]);
  const [markers, setMarkers] = useState<MarkerItem[]>([]);
  const [drafts, setDrafts] = useState(() => listAllDrafts());
  const [notes, setNotes] = useState(() => loadNotes(wsId));
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 「次へ」で送った数。列の先頭を、この数だけ後ろへ回して見せる */
  const [skipped, setSkipped] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const reload = async () => {
      try {
        const [{ input }, m] = await Promise.all([
          loadDesignInput(),
          mcpBridge.request("listAllMarkers", { unresolvedOnly: true }) as Promise<{ items?: MarkerItem[] } | null>,
        ]);
        if (cancelled) return;
        setIssues(buildDesignDocument(input).issues);
        setMarkers(m?.items ?? []);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    const later = () => { clearTimeout(timer); timer = setTimeout(reload, 500); };
    void reload();
    const unsubs = RELOAD_EVENTS.map((ev) => mcpBridge.onBroadcast(ev, later));
    const unsubStatus = mcpBridge.onStatusChange((s) => { if (s === "connected") later(); });
    const onStorage = () => { setDrafts(listAllDrafts()); setNotes(loadNotes(wsId)); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("harmony:notes-changed", onStorage);
    const tid = window.setInterval(onStorage, 5000);
    return () => { cancelled = true; clearTimeout(timer); unsubs.forEach((u) => u()); unsubStatus(); window.removeEventListener("storage", onStorage); window.removeEventListener("harmony:notes-changed", onStorage); window.clearInterval(tid); };
  }, [wsId]);

  const tasks = useMemo(() => buildTodayTasks({ drafts, issues, markers, notes }), [drafts, issues, markers, notes]);
  // 「次へ」で先頭を後ろへ回す (一周したら最初に戻る)
  const rotated = tasks.length > 0 ? [...tasks.slice(skipped % tasks.length), ...tasks.slice(0, skipped % tasks.length)] : [];
  const current = rotated[0];
  const open = (route: string | null) => { if (route) navigate(wsPath(route)); };

  if (error) return <div className="panel-error"><i className="bi bi-exclamation-triangle" /> 読み込めませんでした: {error}</div>;
  if (!loaded) return <div style={{ padding: 8, color: "var(--hm-fg-muted)" }}>調べています…</div>;
  if (!current) {
    return (
      <div style={{ padding: 12 }} data-testid="today-empty">
        <i className="bi bi-check-circle" style={{ color: "var(--hm-success)" }} /> いま、やることはありません。
        <div style={{ color: "var(--hm-fg-muted)", fontSize: "0.8rem", marginTop: 4 }}>未保存の下書き・要確認・未解決のマーカーが、すべて片付いています。</div>
      </div>
    );
  }
  return (
    <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }} data-testid="today-panel">
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <b style={{ fontSize: "1.4rem" }} data-testid="today-total">{tasks.length}</b>
        <span style={{ color: "var(--hm-fg-muted)", fontSize: "0.85rem" }}>件のやること</span>
        <span className="ms-auto" style={{ display: "flex", gap: 6 }}>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => open(current.route)} disabled={!current.route} data-testid="today-open">
            <i className="bi bi-box-arrow-up-right" /> 1 つ目を開く
          </button>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setSkipped((n) => n + 1)} disabled={tasks.length < 2} title="いまの 1 つ目を後ろへ回して、次のものを先頭にします" data-testid="today-next">
            次へ <i className="bi bi-chevron-right" />
          </button>
        </span>
      </div>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {rotated.slice(0, SHOWN).map((t, i) => (
          <li key={t.key} data-testid="today-item" style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "4px 6px", borderRadius: 6, background: i === 0 ? "var(--hm-accent-soft)" : "transparent" }}>
            <i className={`bi ${KIND_ICON[t.kind]}`} style={{ color: KIND_COLOR[t.kind] }} title={TODAY_KIND_LABELS[t.kind]} aria-label={TODAY_KIND_LABELS[t.kind]} />
            {t.route
              ? <button type="button" className="btn btn-link p-0" style={{ textAlign: "left" }} onClick={() => open(t.route)}>{t.title}</button>
              : <span>{t.title}</span>}
            <span style={{ color: "var(--hm-fg-muted)", fontSize: "0.78rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.detail}</span>
          </li>
        ))}
      </ol>
      {tasks.length > SHOWN && <div style={{ color: "var(--hm-fg-muted)", fontSize: "0.78rem" }}>ほか {tasks.length - SHOWN} 件</div>}
    </div>
  );
}
