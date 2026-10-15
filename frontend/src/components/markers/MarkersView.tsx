/**
 * マーカー一覧。全設計 (処理フロー・画面・テーブル・ビュー・ビュー定義・シーケンス・ページレイアウト) の、
 * AI への指示・質問を横断して見る画面。古いもの (滞っているもの) から並べ、絞り込み・一括の解決・
 * 「AI に渡す文をコピー」ができる。マーカーの追加は、各設計の編集画面で行う (位置を指せるため)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MARKER_ENTITY_LABELS, MARKER_ENTITY_TYPES, anchorLabel, buildAiPrompt, type MarkerEntityType } from "@harmony/shared";
import { mcpBridge } from "../../mcp/mcpBridge";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { reportFailure } from "../../utils/failureToast";
import { showToast } from "../../utils/toast";
import { ageDays, filterMarkerItems, markerEntityRoute, DEFAULT_MARKER_FILTER, type MarkerFilterState, type MarkerItem } from "../../utils/markerOverview";
import type { Marker, MarkerKind } from "../../types/v3";
import { AnTable, Section } from "../analysis/ui";
import { MARKER_KIND_ICONS, MARKER_KIND_LABELS } from "../common/MarkerListPanel";
import { copyText } from "../analysis/fileIo";
import "../../styles/analysis.css";

const CHANGE_EVENTS = ["processFlowChanged", "screenChanged", "tableChanged", "viewChanged", "viewDefinitionChanged", "sequenceChanged", "pageLayoutChanged", "projectChanged"];
const KINDS: MarkerKind[] = ["chat", "attention", "todo", "question"];
const keyOf = (i: MarkerItem) => `${i.entityType}:${i.entityId}:${i.marker.id}`;

export function MarkersView() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [items, setItems] = useState<MarkerItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MarkerFilterState>(DEFAULT_MARKER_FILTER);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reload = useCallback(() => {
    mcpBridge.request("listAllMarkers", {})
      .then((r) => { setItems(((r as { items?: MarkerItem[] } | null)?.items) ?? []); setError(null); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    mcpBridge.startWithoutEditor();
    const first = setTimeout(reload, 0);
    const later = () => { clearTimeout(timer.current); timer.current = setTimeout(reload, 300); };
    const unsubs = CHANGE_EVENTS.map((ev) => mcpBridge.onBroadcast(ev, later));
    const unsubStatus = mcpBridge.onStatusChange((s) => { if (s === "connected") later(); });
    return () => { clearTimeout(first); clearTimeout(timer.current); unsubs.forEach((u) => u()); unsubStatus(); };
  }, [reload]);

  const shown = useMemo(() => filterMarkerItems(items ?? [], filter), [items, filter]);
  const shownKeys = useMemo(() => new Set(shown.map(keyOf)), [shown]);
  // 見えなくなった (絞り込み・解決で) ものは、選択から外す
  useEffect(() => { setPicked((p) => { const next = new Set([...p].filter((k) => shownKeys.has(k))); return next.size === p.size ? p : next; }); }, [shownKeys]);

  const target = picked.size > 0 ? shown.filter((i) => picked.has(keyOf(i))) : shown;
  const targetOpen = target.filter((i) => !i.marker.resolvedAt);

  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allPicked = shown.length > 0 && shown.every((i) => picked.has(keyOf(i)));

  const copyForAi = () => {
    const text = buildAiPrompt(targetOpen.map((i) => ({ entityType: i.entityType, entityId: i.entityId, entityName: i.entityName, marker: i.marker })));
    if (!text) { showToast("AI に渡す未解決のマーカーがありません", "info"); return; }
    void copyText(text, `AI に渡す文をコピーしました (${targetOpen.length} 件)。Claude Code などに貼り付けてください`);
  };

  const resolvePicked = async () => {
    const open = shown.filter((i) => picked.has(keyOf(i)) && !i.marker.resolvedAt);
    if (open.length === 0) return;
    setBusy(true);
    try {
      const resolvedAt = new Date().toISOString();
      const groups = new Map<string, MarkerItem[]>();
      for (const i of open) groups.set(`${i.entityType}:${i.entityId}`, [...(groups.get(`${i.entityType}:${i.entityId}`) ?? []), i]);
      for (const list of groups.values()) {
        const updated: Marker[] = list.map((i) => ({ ...i.marker, resolvedAt: resolvedAt as Marker["resolvedAt"], resolution: note.trim() || "(一覧からまとめて解決)" }));
        await mcpBridge.request("applyMarkerChanges", { entityType: list[0].entityType, entityId: list[0].entityId, changes: { updated } });
      }
      showToast(`${open.length} 件を解決しました`, "success");
      setPicked(new Set());
      setNote("");
      reload();
    } catch (e) {
      reportFailure(e, "マーカーの一括解決");
      reload();
    } finally {
      setBusy(false);
    }
  };

  const setKind = (k: MarkerKind) => setFilter((f) => ({ ...f, kind: f.kind === k ? null : k }));

  return (
    <div className="an-root" data-testid="markers-view">
      <header className="an-toolbar">
        <h1 className="an-title"><i className="bi bi-megaphone" /> マーカー (AI への指示・質問)</h1>
        <span className="an-sub">全設計のマーカーを、古いものから並べます。追加は、各設計の編集画面で (位置を指せます)。</span>
      </header>
      <div className="an-body">
        <div className="an-pane">
          <Section title="一覧" hint={items ? `${shown.length} 件を表示 (全 ${items.length} 件)` : "読み込み中…"}
            actions={(
              <>
                <button type="button" className="an-btn" onClick={copyForAi} disabled={targetOpen.length === 0} data-testid="markers-copy-ai"
                  title="未解決のマーカーを、AI (Claude Code など) にそのまま貼れる依頼の文にしてコピーします (選んだものがあれば、選んだものだけ)">
                  <i className="bi bi-clipboard" /> AI に渡す文をコピー{picked.size > 0 ? ` (選択 ${picked.size})` : ""}
                </button>
              </>
            )}>
            <div className="an-form-row">
              <label>設計の種類
                <select className="an-input" value={filter.entityType ?? ""} onChange={(e) => setFilter((f) => ({ ...f, entityType: (e.target.value || null) as MarkerEntityType | null }))} data-testid="markers-type">
                  <option value="">すべて</option>
                  {MARKER_ENTITY_TYPES.map((t) => <option key={t} value={t}>{MARKER_ENTITY_LABELS[t]}</option>)}
                </select>
              </label>
              <label>語で探す
                <input className="an-input" value={filter.query} onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))} placeholder="本文・設計の名前" data-testid="markers-query" />
              </label>
              <label className="an-check"><input type="checkbox" checked={filter.includeResolved} onChange={(e) => setFilter((f) => ({ ...f, includeResolved: e.target.checked }))} data-testid="markers-resolved" /> 解決済みも表示</label>
            </div>
            <div className="an-subtabs" role="group" aria-label="種類">
              {KINDS.map((k) => (
                <button key={k} type="button" className={filter.kind === k ? "on" : ""} aria-pressed={filter.kind === k} onClick={() => setKind(k)} data-testid={`markers-kind-${k}`}>
                  <i className={`bi ${MARKER_KIND_ICONS[k]}`} /> {MARKER_KIND_LABELS[k]}
                </button>
              ))}
            </div>
            {error ? <p className="an-alert" role="alert">{error}</p> : null}
            {picked.size > 0 && (
              <div className="an-row" data-testid="markers-bulk">
                <span className="an-hint">{picked.size} 件を選択中</span>
                <input className="an-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="解決メモ (任意)" style={{ minWidth: "16em" }} data-testid="markers-note" />
                <button type="button" className="an-btn primary" onClick={() => { void resolvePicked(); }} disabled={busy || shown.every((i) => !picked.has(keyOf(i)) || !!i.marker.resolvedAt)} data-testid="markers-resolve-picked">
                  <i className="bi bi-check2-all" /> 選んだものを解決
                </button>
                <button type="button" className="an-btn" onClick={() => setPicked(new Set())}>選択を外す</button>
              </div>
            )}
            <AnTable
              testId="markers-table"
              headers={["", "設計", "位置", "種類", "書き手", "経過", "本文"]}
              empty={items === null ? "読み込み中…" : "該当するマーカーはありません。設計の編集画面の「マーカー」から、AI への指示・質問を付けられます。"}
              rows={shown.map((i) => [
                <input key="c" type="checkbox" checked={picked.has(keyOf(i))} onChange={() => toggle(keyOf(i))} aria-label={`${i.entityName || i.entityId}のマーカーを選ぶ`} />,
                <span key="e"><button type="button" className="an-link" onClick={() => navigate(wsPath(markerEntityRoute(i.entityType, i.entityId)))} title="この設計を開く">{i.entityName || i.entityId}</button><small className="an-hint"> {MARKER_ENTITY_LABELS[i.entityType]}</small></span>,
                <span key="a">{anchorLabel(i.marker.anchor)}</span>,
                <span key="k"><i className={`bi ${MARKER_KIND_ICONS[i.marker.kind]}`} /> {MARKER_KIND_LABELS[i.marker.kind]}</span>,
                <span key="u">{i.marker.author === "human" ? "人間" : "AI"}</span>,
                <span key="d" style={{ whiteSpace: "nowrap" }}>{i.marker.resolvedAt ? "解決済み" : `${ageDays(i.marker.createdAt)} 日`}</span>,
                <span key="b" style={{ whiteSpace: "pre-wrap" }}>{i.marker.body}{i.marker.resolvedAt && i.marker.resolution ? <small className="an-hint"> — {i.marker.resolution}</small> : null}</span>,
              ])}
            />
            {shown.length > 0 && (
              <label className="an-check"><input type="checkbox" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(shown.map(keyOf)))} data-testid="markers-pick-all" /> 表示中のものをすべて選ぶ</label>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
