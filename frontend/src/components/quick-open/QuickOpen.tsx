/**
 * クイックオープン (Ctrl+K)。画面・テーブル・処理フロー・業務フロー・帳票・各種ページを、
 * ID・名前・物理名で 1 つの検索ボックスから探して開く。一覧を辿らずに目的の設計書へ飛ぶための入口。
 * コマンドパレットも兼ねる: 「>」で始めると、保存・元に戻す・配色や表示の設定・タブの操作などの「操作」を探して実行できる
 * (「>」なしでも、検索語に合う操作は、名前の候補の後ろに出る)。お気に入り (★) は、検索語が空のとき先頭に出る。
 *
 * 候補は開くたびに読み直す (他で追加・改名されたものも出る)。
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getActiveTabId, getTabs, type TabItem } from "../../store/tabStore";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { mcpBridge } from "../../mcp/mcpBridge";
import { isFavorite, toggleFavorite, useFavorites } from "../../utils/favorites";
import { loadQuickOpenSources, openQuickOpenEntry } from "./loadSources";
import { buildPaletteCommands, type PaletteCommand } from "./paletteCommands";
import {
  QUICK_OPEN_KIND_ICONS,
  QUICK_OPEN_KIND_LABELS,
  buildQuickOpenEntries,
  contentHitsToEntries,
  loadRecentQuickOpen,
  searchCommands,
  searchQuickOpen,
  type ContentSearchHit,
  type QuickOpenContentEntry,
  type QuickOpenEntry,
} from "../../utils/quickOpen";
import "../../styles/quickOpen.css";
import { isImeComposing } from "../../utils/imeKeys";

/** 一覧の 1 行。設計の候補か、実行する操作 */
type Row = { type: "entry"; entry: QuickOpenEntry | QuickOpenContentEntry } | { type: "command"; cmd: PaletteCommand };

const COMMAND_PREFIX = ">";

function activeTabNow(): TabItem | null {
  const id = getActiveTabId();
  return getTabs().find((t) => t.id === id) ?? null;
}

export function QuickOpen() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<QuickOpenEntry[] | null>(null);
  const [cursor, setCursor] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<TabItem | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();
  const { wsPath, wsId } = useWorkspacePath();
  const favorites = useFavorites(wsId);

  const returnFocusTo = useRef<HTMLElement | null>(null);
  const reset = useCallback((initialQuery = "") => {
    returnFocusTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery(initialQuery); setCursor(0); setRecent(loadRecentQuickOpen()); setActiveTab(activeTabNow());
  }, []);
  const show = useCallback(() => { reset(); setOpen(true); }, [reset]);

  // Ctrl+K (Mac は ⌘K) でどこからでも開く。入力欄にフォーカスがあっても開く。Ctrl+Shift+P は「>」つき (操作を探す)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const isK = (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && k === "k";
      const isP = (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && k === "p";
      if (!isK && !isP) return;
      e.preventDefault();
      setOpen((v) => {
        if (!v) reset(isP ? COMMAND_PREFIX : "");
        return isP ? true : !v;
      });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [reset]);

  // 開くたびに候補を読み直す
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setEntries(null);
    // 本文検索の読み込みを先に済ませておく (打ち始めてすぐ結果が出るように)。結果は使わない
    mcpBridge.request("searchDesign", { query: "", warm: true }).catch(() => undefined);
    loadQuickOpenSources().then((src) => { if (alive) setEntries(buildQuickOpenEntries(src)); }).catch(() => { if (alive) setEntries([]); });
    inputRef.current?.focus();
    return () => { alive = false; };
  }, [open]);

  // 閉じたら、開く前にフォーカスしていた場所へ戻す (キーボード操作の途中で見失わないように)
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) returnFocusTo.current?.focus?.();
    wasOpen.current = open;
  }, [open]);

  const commandMode = query.startsWith(COMMAND_PREFIX);
  const commandQuery = commandMode ? query.slice(COMMAND_PREFIX.length) : query;
  const allCommands = useMemo(() => (open ? buildPaletteCommands({ activeTab, wsId }) : []), [open, activeTab, wsId]);

  const nameHits = useMemo(
    () => (entries && !commandMode ? searchQuickOpen(entries, query, 50, recent, favorites) : []),
    [entries, query, recent, favorites, commandMode],
  );

  // 本文の一致 (説明・カラム名・項目のラベル・工程の説明など)。2 文字以上で、入力が止まってから backend に尋ねる
  const [content, setContent] = useState<{ query: string; hits: ContentSearchHit[] }>({ query: "", hits: [] });
  useEffect(() => {
    const q = query.trim();
    if (!open || commandMode || q.length < 2) { setContent({ query: "", hits: [] }); return; }
    let alive = true;
    const timer = setTimeout(() => {
      mcpBridge.request("searchDesign", { query: q }).then((res) => {
        if (alive) setContent({ query: q, hits: ((res as { hits?: ContentSearchHit[] } | null)?.hits) ?? [] });
      }).catch(() => { if (alive) setContent({ query: q, hits: [] }); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [open, query, commandMode]);

  const contentEntries = useMemo<QuickOpenContentEntry[]>(
    // 入力を変えた直後は、前の入力の本文候補を出さない (応答が来るまでのあいだに Enter を押しても、合わない候補を開かない)
    () => (content.query === query.trim() ? contentHitsToEntries(content.hits, new Set(nameHits.map((h) => h.entry.key))) : []),
    [content, query, nameHits],
  );
  // 「>」なら操作だけ。ふつうの検索では、語があるときだけ、合う操作を名前の候補の後ろに出す
  const commandHits = useMemo(
    () => (commandMode ? searchCommands(allCommands, commandQuery) : query.trim() ? searchCommands(allCommands, query, 5) : []),
    [allCommands, commandMode, commandQuery, query],
  );
  const rows = useMemo<Row[]>(
    () => [
      ...nameHits.map((h): Row => ({ type: "entry", entry: h.entry })),
      ...commandHits.map((cmd): Row => ({ type: "command", cmd })),
      ...contentEntries.map((entry): Row => ({ type: "entry", entry })),
    ],
    [nameHits, commandHits, contentEntries],
  );
  const firstCommandIndex = commandMode ? -1 : nameHits.length;
  const firstContentIndex = nameHits.length + commandHits.length;

  useEffect(() => { setCursor(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const run = useCallback((row: Row) => {
    setOpen(false);
    if (row.type === "command") { row.cmd.run(); return; }
    openQuickOpenEntry(row.entry, navigate, wsPath);
  }, [navigate, wsPath]);

  const onInputKey = (e: React.KeyboardEvent) => {
    // 日本語入力の変換中の Esc / Enter は、変換の取り消し・確定に使うので、ここでは扱わない
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
    else if (e.key === "Tab") { e.preventDefault(); } // 開いている間は、フォーカスを入力欄から出さない
    else if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, Math.max(rows.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === "Enter" && !isImeComposing(e)) { e.preventDefault(); if (rows[cursor]) run(rows[cursor]); }
    else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d") {
      // Ctrl+D: 選んでいる候補を、お気に入りに追加 / 解除 (ブラウザのブックマークは開かない)
      e.preventDefault();
      const row = rows[cursor];
      if (row?.type === "entry" && canFavorite(row.entry)) toggleFavorite(wsId, row.entry.key);
    }
  };

  return (
    <>
      <button type="button" className="common-header-icon-btn quick-open-trigger" data-testid="quick-open-trigger"
        title="画面・テーブル・処理フローなどを探して開く / 操作を探して実行する (Ctrl+K)" aria-label="クイックオープン" onClick={show}>
        <i className="bi bi-search" />
      </button>
      {open && <div className="quick-open-overlay" data-testid="quick-open" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
        <div className="quick-open-modal" role="dialog" aria-modal="true" aria-label="クイックオープン">
          <div className="quick-open-input-row">
            <i className={`bi ${commandMode ? "bi-terminal" : "bi-search"}`} />
            <input
              ref={inputRef}
              autoFocus
              className="quick-open-input"
              data-testid="quick-open-input"
              placeholder="画面・テーブル・処理フローなどを ID や名前で探す  (例: 注文 テーブル)。「>」で操作を探す"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              role="combobox"
              aria-expanded="true"
              aria-controls="quick-open-list"
              aria-activedescendant={rows[cursor] ? `quick-open-opt-${cursor}` : undefined}
            />
            <kbd>Esc</kbd>
          </div>
          <ul className="quick-open-list" id="quick-open-list" role="listbox" ref={listRef} data-testid="quick-open-list">
            {entries === null && !commandMode && <li className="quick-open-empty">読み込み中...</li>}
            {(entries !== null || commandMode) && rows.length === 0 && <li className="quick-open-empty" data-testid="quick-open-empty">「{commandMode ? commandQuery : query}」に一致する{commandMode ? "操作" : "もの"}はありません</li>}
            {rows.map((row, i) => (
              <Fragment key={`${i}:${row.type === "entry" ? row.entry.key : row.cmd.id}`}>
              {i === firstCommandIndex && commandHits.length > 0 && (
                <li className="quick-open-section" role="presentation" data-testid="quick-open-command-head">操作</li>
              )}
              {i === firstContentIndex && contentEntries.length > 0 && (
                <li className="quick-open-section" role="presentation" data-testid="quick-open-content-head">本文の一致 (説明・カラム・項目・工程など)</li>
              )}
              {row.type === "command" ? (
                <li
                  id={`quick-open-opt-${i}`}
                  data-index={i}
                  data-testid="quick-open-command"
                  data-command={row.cmd.id}
                  role="option"
                  aria-selected={i === cursor}
                  className={`quick-open-item${i === cursor ? " active" : ""}`}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => run(row)}
                >
                  <i className={`bi ${row.cmd.icon}`} />
                  <span className="quick-open-label">{row.cmd.label}</span>
                  <span className="quick-open-id">{row.cmd.hint ?? ""}</span>
                  <span className="quick-open-kind">操作</span>
                </li>
              ) : (
                <li
                  id={`quick-open-opt-${i}`}
                  data-index={i}
                  data-testid="quick-open-item"
                  data-key={row.entry.key}
                  role="option"
                  aria-selected={i === cursor}
                  className={`quick-open-item${i === cursor ? " active" : ""}`}
                  onMouseMove={() => setCursor(i)}
                  onClick={() => run(row)}
                >
                  <i className={`bi ${QUICK_OPEN_KIND_ICONS[row.entry.kind]}`} />
                  <span className="quick-open-label">{row.entry.label}</span>
                  {"detail" in row.entry ? (
                    <span className="quick-open-detail" data-testid="quick-open-detail">{row.entry.detail}</span>
                  ) : (
                    row.entry.kind !== "page" && row.entry.kind !== "create" && <span className="quick-open-id">{row.entry.id}</span>
                  )}
                  {query.trim() === "" && recent.includes(row.entry.key) && !isFavorite(wsId, row.entry.key) && <span className="quick-open-recent" title="最近開いた"><i className="bi bi-clock-history" /></span>}
                  {canFavorite(row.entry) && (
                    <button type="button" tabIndex={-1} className={`quick-open-star${isFavorite(wsId, row.entry.key) ? " is-on" : ""}`} data-testid="quick-open-star"
                      title={isFavorite(wsId, row.entry.key) ? "お気に入りから外す (Ctrl+D)" : "お気に入りに追加 (Ctrl+D)"}
                      aria-label={isFavorite(wsId, row.entry.key) ? `${row.entry.label}をお気に入りから外す` : `${row.entry.label}をお気に入りに追加`}
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(wsId, row.entry.key); inputRef.current?.focus(); }}>
                      <i className={`bi ${isFavorite(wsId, row.entry.key) ? "bi-star-fill" : "bi-star"}`} />
                    </button>
                  )}
                  <span className="quick-open-kind">{QUICK_OPEN_KIND_LABELS[row.entry.kind]}</span>
                </li>
              )}
              </Fragment>
            ))}
          </ul>
          <div className="quick-open-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd> 選ぶ</span>
            <span><kbd>Enter</kbd> 開く・実行</span>
            <span><kbd>Ctrl</kbd><kbd>D</kbd> お気に入り</span>
            <span><kbd>&gt;</kbd> 操作 (保存・配色など)</span>
            <span>空白で区切ると絞り込み (例: <code>注文 帳票</code>)</span>
          </div>
        </div>
      </div>}
    </>
  );
}

/** お気に入りにできる候補 (設計。ページ・新規作成は対象外) */
function canFavorite(entry: QuickOpenEntry): boolean {
  return entry.kind !== "page" && entry.kind !== "create";
}

