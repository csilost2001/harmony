/**
 * クイックオープン (Ctrl+K)。画面・テーブル・処理フロー・業務フロー・帳票・各種ページを、
 * ID・名前・物理名で 1 つの検索ボックスから探して開く。一覧を辿らずに目的の設計書へ飛ぶための入口。
 *
 * 候補は開くたびに読み直す (他で追加・改名されたものも出る)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadProject } from "../../store/flowStore";
import { listBusinessFlows } from "../../store/businessFlowStore";
import { listReports } from "../../store/reportStore";
import { clearActiveTab, getActiveTabId, getTabs } from "../../store/tabStore";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { DASHBOARD_ITEM, MENU_ITEMS } from "../menuItems";
import {
  QUICK_OPEN_KIND_ICONS,
  QUICK_OPEN_KIND_LABELS,
  buildQuickOpenEntries,
  loadRecentQuickOpen,
  rememberQuickOpen,
  searchQuickOpen,
  type QuickOpenEntry,
  type QuickOpenSources,
} from "../../utils/quickOpen";
import "../../styles/quickOpen.css";

/** /workspace/* と /ai-settings はワークスペースの外にある (HeaderMenu と同じ扱い) */
const isWorkspaceScoped = (route: string) => !route.startsWith("/workspace/") && route !== "/ai-settings";

async function loadSources(): Promise<QuickOpenSources> {
  const [project, businessFlows, reports] = await Promise.allSettled([loadProject(), listBusinessFlows(), listReports()]);
  const p = project.status === "fulfilled" ? project.value : null;
  return {
    screens: (p?.screens ?? []).filter((s) => s.purpose !== "gadget").map((s) => ({ id: s.id, name: s.name, path: s.path })),
    tables: (p?.tables ?? []).map((t) => ({ id: t.id, name: t.name, physicalName: t.physicalName })),
    processFlows: (p?.processFlows ?? []).map((f) => ({ id: f.id, name: f.name })),
    sequences: (p?.sequences ?? []).map((s) => ({ id: s.id, name: s.name, physicalName: s.physicalName })),
    views: (p?.views ?? []).map((v) => ({ id: v.id, name: v.name, physicalName: v.physicalName })),
    viewDefinitions: (p?.viewDefinitions ?? []).map((v) => ({ id: v.id, name: v.name })),
    businessFlows: businessFlows.status === "fulfilled" ? businessFlows.value.map((f) => ({ id: f.id, name: f.name })) : [],
    reports: reports.status === "fulfilled" ? reports.value.map((r) => ({ id: r.id, name: r.name })) : [],
    pages: [DASHBOARD_ITEM, ...MENU_ITEMS].map((m) => ({ id: m.id, label: m.label, route: m.route })),
  };
}

export function QuickOpen() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<QuickOpenEntry[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();

  const show = useCallback(() => { setQuery(""); setCursor(0); setRecent(loadRecentQuickOpen()); setOpen(true); }, []);

  // Ctrl+K (Mac は ⌘K) でどこからでも開く。入力欄にフォーカスがあっても開く
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => { if (!v) { setQuery(""); setCursor(0); setRecent(loadRecentQuickOpen()); } return !v; });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // 開くたびに候補を読み直す
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setEntries(null);
    loadSources().then((src) => { if (alive) setEntries(buildQuickOpenEntries(src)); }).catch(() => { if (alive) setEntries([]); });
    inputRef.current?.focus();
    return () => { alive = false; };
  }, [open]);

  const hits = useMemo(() => (entries ? searchQuickOpen(entries, query, 50, recent) : []), [entries, query, recent]);

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const go = useCallback((entry: QuickOpenEntry) => {
    // デザインタブがアクティブなままだと、遷移先が表示されない (HeaderMenu と同じ処理)
    const activeId = getActiveTabId();
    if (getTabs().some((t) => t.id === activeId && t.type === "design")) clearActiveTab();
    rememberQuickOpen(entry.key);
    navigate(isWorkspaceScoped(entry.route) ? wsPath(entry.route) : entry.route);
    setOpen(false);
  }, [navigate, wsPath]);

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, Math.max(hits.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); if (hits[cursor]) go(hits[cursor].entry); }
  };

  return (
    <>
      <button type="button" className="common-header-icon-btn quick-open-trigger" data-testid="quick-open-trigger"
        title="画面・テーブル・処理フローなどを探して開く (Ctrl+K)" aria-label="クイックオープン" onClick={show}>
        <i className="bi bi-search" />
      </button>
      {open && <div className="quick-open-overlay" data-testid="quick-open" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
        <div className="quick-open-modal" role="dialog" aria-modal="true" aria-label="クイックオープン">
          <div className="quick-open-input-row">
            <i className="bi bi-search" />
            <input
              ref={inputRef}
              autoFocus
              className="quick-open-input"
              data-testid="quick-open-input"
              placeholder="画面・テーブル・処理フローなどを ID や名前で探す  (例: 注文 テーブル)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              role="combobox"
              aria-expanded="true"
              aria-controls="quick-open-list"
            />
            <kbd>Esc</kbd>
          </div>
          <ul className="quick-open-list" id="quick-open-list" role="listbox" ref={listRef} data-testid="quick-open-list">
            {entries === null && <li className="quick-open-empty">読み込み中...</li>}
            {entries !== null && hits.length === 0 && <li className="quick-open-empty" data-testid="quick-open-empty">「{query}」に一致するものはありません</li>}
            {hits.map(({ entry }, i) => (
              <li
                key={entry.key}
                data-index={i}
                data-testid="quick-open-item"
                data-key={entry.key}
                role="option"
                aria-selected={i === cursor}
                className={`quick-open-item${i === cursor ? " active" : ""}`}
                onMouseMove={() => setCursor(i)}
                onClick={() => go(entry)}
              >
                <i className={`bi ${QUICK_OPEN_KIND_ICONS[entry.kind]}`} />
                <span className="quick-open-label">{entry.label}</span>
                {entry.kind !== "page" && <span className="quick-open-id">{entry.id}</span>}
                {query.trim() === "" && recent.includes(entry.key) && <span className="quick-open-recent" title="最近開いた"><i className="bi bi-clock-history" /></span>}
                <span className="quick-open-kind">{QUICK_OPEN_KIND_LABELS[entry.kind]}</span>
              </li>
            ))}
          </ul>
          <div className="quick-open-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> 選ぶ</span>
            <span><kbd>Enter</kbd> 開く</span>
            <span>空白で区切ると絞り込み (例: <code>注文 帳票</code>)</span>
          </div>
        </div>
      </div>}
    </>
  );
}
