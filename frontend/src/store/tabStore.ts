import { recordError } from "../utils/errorLog";
import { uiInfo } from "../utils/uiLog";
import { isValidUuid } from "../utils/entityIdValidation";
import { isPaneMode, postToParent } from "../utils/paneMode";
import { recordOpened } from "../utils/openedHistory";

const TABS_KEY = "harmony-open-tabs";
const ACTIVE_KEY = "harmony-active-tab";

export type TabType =
  // マルチインスタンス（リソース ID 毎に独立タブ）
  | "design"          // 画面デザイナー
  | "table"           // テーブル編集
  | "process-flow"    // 処理フロー編集
  | "sequence"        // シーケンス編集 (#374)
  | "view"            // ビュー編集 (#376)
  | "view-definition" // ビュー定義編集 (#666)
  | "screen-items"    // 画面項目定義 (#318 / #696 per-screen タブ化)
  | "page-layout"     // ページレイアウト編集 (#1024)
  | "business-flow"   // 業務フロー編集 (再設計 2026-10 段階 4)
  | "report"          // 帳票編集 (再設計 2026-10 段階 4)
  // シングルトン（1 インスタンス固定。resourceId は "main" で統一）
  | "screen-flow"        // 画面フロー図
  | "screen-list"        // 画面一覧 (#133 Phase C)
  | "table-list"         // テーブル一覧
  | "er"                 // ER 図
  | "process-flow-list"  // 処理フロー一覧
  | "extensions"         // 拡張管理 (#447)
  | "conventions-catalog" // 規約カタログ (#317)
  | "sequence-list"      // シーケンス一覧 (#374)
  | "view-list"          // ビュー一覧 (#376)
  | "view-definition-list" // ビュー定義一覧 (#666)
  | "workspace-list"     // ワークスペース一覧 (#673)
  | "tech-stack"         // 技術スタック選定 (#826)
  | "dashboard"          // ダッシュボード（#86 PR-3 で有効化）
  | "page-layout-list"  // ページレイアウト一覧 (#1024)
  | "gadget-list"       // ガジェット一覧 (#1025)
  | "generic-definition"        // 汎用定義編集 (#1069)
  | "generic-definition-list"   // 汎用定義一覧 (#1069)
  | "generic-definition-catalog" // 汎用定義カタログ (#1069)
  | "report-list"        // 帳票一覧 (再設計 2026-10 段階 4)
  | "business-flow-list" // 業務フロー一覧 (再設計 2026-10 段階 4)
  | "design-document" // 設計書 (再設計 2026-10 段階 3)
  | "design-analysis" // 設計の分析 (改善提案 第 3 弾)
  | "operations" // 連携と運用 (改善提案 第 5 弾)
  | "markers"; // マーカー一覧 (UI 改善 第 4 弾)

const KNOWN_TAB_TYPES: ReadonlySet<TabType> = new Set([
  "design", "table", "process-flow", "sequence", "view", "view-definition", "screen-items", "page-layout", "business-flow", "report",
  "screen-flow", "screen-list", "table-list", "er", "process-flow-list",
  "extensions", "conventions-catalog", "sequence-list", "view-list", "view-definition-list",
  "workspace-list", "tech-stack", "dashboard", "page-layout-list", "gadget-list",
  "generic-definition", "generic-definition-list", "generic-definition-catalog",
  "design-document", "business-flow-list", "report-list", "design-analysis", "operations", "markers",
]);

// RFC #1284 (#1296 I-4): top-level entity の id 体系を UUID → kebab-case EntityId に移行。
// per-resource タブ kind は resourceId が UUID 形式の場合、migration 後に backend で解決不能 (404)。
// localStorage ロード時に破棄して死タブを除去する。
// シングルトンタブ (resourceId="main") や、namespace:name 形式 (generic-definition) は影響なし。
const RESOURCE_TAB_TYPES: ReadonlySet<TabType> = new Set([
  "design", "table", "process-flow", "sequence", "view", "view-definition", "screen-items", "page-layout", "business-flow", "report",
]);

export interface TabItem {
  id: string;
  type: TabType;
  resourceId: string;
  label: string;
  isDirty: boolean;
  isPinned: boolean;
}

type Listener = () => void;

let _tabs: TabItem[] = _loadTabs();
let _activeTabId: string = _loadActiveId();
const _listeners = new Set<Listener>();

// ── 閉じたタブ (開き直す用) と、開いた順の履歴 (戻る / 進む) ─────────────────────────
const CLOSED_KEY = "harmony-closed-tabs";
const CLOSED_MAX = 10;
const HISTORY_MAX = 50;
export type ClosedTab = Omit<TabItem, "isDirty">;
let _closed: ClosedTab[] = _loadClosed();
/** 開いた (切り替えた) タブの順。_histIdx が「いま」の位置。戻る / 進むは、ここを動かすだけで記録は増やさない */
let _hist: string[] = _activeTabId ? [_activeTabId] : [];
let _histIdx = _hist.length - 1;

function _loadClosed(): ClosedTab[] {
  if (isPaneMode()) return [];
  try {
    const v = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter((t) => _isValidTab({ ...t, isDirty: false })).slice(0, CLOSED_MAX).map((t) => ({ ...t, isPinned: Boolean(t.isPinned) }));
  } catch { return []; }
}

function _rememberClosed(removed: readonly TabItem[]): void {
  if (isPaneMode() || removed.length === 0) return;
  // 新しく閉じたものが先頭。同じタブは 1 つだけ
  const add = [...removed].reverse().map(({ isDirty: _d, ...rest }) => rest as ClosedTab);
  const ids = new Set(add.map((t) => t.id));
  _closed = [...add, ..._closed.filter((t) => !ids.has(t.id))].slice(0, CLOSED_MAX);
  try { localStorage.setItem(CLOSED_KEY, JSON.stringify(_closed)); } catch { /* 記録できなくても閉じる動作は妨げない */ }
}

let _flash: { id: string; seq: number } | null = null;
let _flashSeq = 0;
/** 既存のタブへ移ったばかりのタブ (光らせる印)。seq が変わるたびに光る */
export function getTabFlash(): { id: string; seq: number } | null { return _flash; }

function _visit(id: string): void {
  if (id && !isPaneMode()) recordOpened(id);
  if (!id || _hist[_histIdx] === id) return;
  _hist = [..._hist.slice(0, _histIdx + 1), id].slice(-HISTORY_MAX);
  _histIdx = _hist.length - 1;
}

function _notify() {
  _listeners.forEach((fn) => fn());
}

function _isValidTab(t: unknown): t is TabItem {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  if (
    !(typeof o.id === "string" && o.id.length > 0 &&
      typeof o.type === "string" && KNOWN_TAB_TYPES.has(o.type as TabType) &&
      typeof o.resourceId === "string" && o.resourceId.length > 0 &&
      typeof o.label === "string")
  ) {
    return false;
  }
  // #696: screen-items は per-screen タブ化されたため、旧 singleton 形式 (resourceId="singleton") は無効
  if (o.type === "screen-items" && o.resourceId === "singleton") return false;
  // RFC #1284 (#1296 I-4): per-resource タブ kind で resourceId が旧 UUID 形式なら破棄。
  // I-3 で examples / data が kebab-case id に移行済のため、UUID resourceId は解決不能。
  if (RESOURCE_TAB_TYPES.has(o.type as TabType) && isValidUuid(o.resourceId)) return false;
  return true;
}

function _loadTabs(): TabItem[] {
  // 並べて表示の右ペインは、左のアプリのタブの記録を読まない (空から始める。URL のタブだけ開く)
  if (isPaneMode()) return [];
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      recordError({ source: "manual", message: "tabStore: open-tabs が配列でないためリセット", context: { raw } });
      return [];
    }
    const valid: TabItem[] = [];
    const dropped: unknown[] = [];
    for (const t of parsed) {
      if (_isValidTab(t)) {
        valid.push({ ...t, isDirty: false, isPinned: Boolean(t.isPinned) });
      } else {
        dropped.push(t);
      }
    }
    if (dropped.length > 0) {
      recordError({
        source: "manual",
        message: `tabStore: 不正なタブエントリ ${dropped.length} 件を破棄`,
        context: { dropped },
      });
    }
    return valid;
  } catch (e) {
    recordError({
      source: "manual",
      message: "tabStore: open-tabs の JSON パース失敗、リセット",
      stack: e instanceof Error ? e.stack : undefined,
    });
    return [];
  }
}

function _loadActiveId(): string {
  if (isPaneMode()) return "";
  const v = localStorage.getItem(ACTIVE_KEY) ?? "";
  if (typeof v !== "string") return "";
  // RFC #1284 (#1296 I-4 follow-up S-3): _loadTabs() で破棄された tab (UUID resourceId 等)
  // を指していたら stale なので空文字に reset する。_loadActiveId は _loadTabs の後に呼ぶ前提
  // (module-level 初期化順序: _tabs → _activeTabId)。
  if (v && !_tabs.find((t) => t.id === v)) return "";
  return v;
}

function _persist() {
  // 右ペインは、左のアプリのタブの記録を書き換えない
  if (isPaneMode()) return;
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(_tabs.map((t) => ({ ...t, isDirty: false }))));
    localStorage.setItem(ACTIVE_KEY, _activeTabId);
  } catch { /* ignore */ }
}

export function makeTabId(type: TabType, resourceId: string): string {
  return `${type}:${resourceId}`;
}

/** テスト専用: モジュール状態を初期化する */
export function _resetForTests(): void {
  _tabs = [];
  _activeTabId = "";
  _closed = [];
  _hist = [];
  _histIdx = -1;
  _flash = null;
  _listeners.clear();
}

/** テスト専用: localStorage から再ロードする（起動時のロード挙動を検証するため） */
export function _reloadFromStorageForTests(): void {
  _tabs = _loadTabs();
  _activeTabId = _loadActiveId();
  _closed = _loadClosed();
  _hist = _activeTabId ? [_activeTabId] : [];
  _histIdx = _hist.length - 1;
}

/**
 * workspace 切替前の cleanup 用 (#671/#676 review): 永続化されたタブ一覧と
 * activeTabId を localStorage から完全削除する。reload 直前に呼ぶ前提で、
 * モジュール内の `_tabs` / `_activeTabId` 状態は更新しない (リロードで初期化されるため)。
 */
export function clearPersistedTabs(): void {
  try {
    localStorage.removeItem(TABS_KEY);
    localStorage.removeItem(ACTIVE_KEY);
  } catch { /* private browsing / quota error は無視 */ }
}

export function getTabs(): readonly TabItem[] {
  return _tabs;
}

export function getActiveTabId(): string {
  return _activeTabId;
}

export function subscribe(listener: Listener): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

export function openTab(item: Omit<TabItem, "isDirty" | "isPinned">): void {
  const existing = _tabs.find((t) => t.id === item.id);
  uiInfo("tabsync", existing ? "tab re-activate" : "tab open", { id: item.id, type: item.type, resourceId: item.resourceId });
  if (existing) {
    _tabs = _tabs.map((t) => (t.id === item.id ? { ...t, label: item.label } : t));
    _activeTabId = item.id;
    // 同じ設計を開こうとした: 新しいタブは作らず、既存のタブへ移ったことをタブの光で知らせる
    _flash = { id: item.id, seq: ++_flashSeq };
  } else {
    _tabs = [..._tabs, { ...item, isDirty: false, isPinned: false }];
    _activeTabId = item.id;
  }
  _visit(item.id);
  _persist();
  _notify();
}

/** returns false if tab is dirty and force=false (caller should confirm) */
export function closeTab(id: string, force = false): boolean {
  const tab = _tabs.find((t) => t.id === id);
  if (!tab) return true;
  if (tab.isDirty && !force) return false;

  uiInfo("tabsync", "tab close", { id, type: tab.type, force, isDirty: tab.isDirty });
  const idx = _tabs.findIndex((t) => t.id === id);
  const newTabs = _tabs.filter((t) => t.id !== id);
  _tabs = newTabs;
  _rememberClosed([tab]);

  if (_activeTabId === id) {
    _activeTabId = newTabs[Math.min(idx, newTabs.length - 1)]?.id ?? "";
    _visit(_activeTabId);
  }
  _persist();
  _notify();
  return true;
}

export function setActiveTab(id: string): void {
  if (_activeTabId === id) return;
  uiInfo("tabsync", "setActiveTab", { from: _activeTabId, to: id });
  _activeTabId = id;
  _visit(id);
  _persist();
  _notify();
}

export function clearActiveTab(): void {
  if (_activeTabId === "") return;
  _activeTabId = "";
  _persist();
  _notify();
}

export function reorderTabs(fromIndex: number, toIndex: number): void {
  const arr = [..._tabs];
  const [removed] = arr.splice(fromIndex, 1);
  arr.splice(toIndex, 0, removed);
  _tabs = arr;
  _persist();
  _notify();
}

/** タブを左 (-1) / 右 (+1) へ 1 つ動かす (ドラッグの代わり)。端なら動かさず false */
export function moveTabBy(id: string, delta: -1 | 1): boolean {
  const from = _tabs.findIndex((t) => t.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= _tabs.length) return false;
  reorderTabs(from, to);
  return true;
}

export function setDirty(id: string, dirty: boolean): void {
  const tab = _tabs.find((t) => t.id === id);
  if (!tab || tab.isDirty === dirty) return;
  _tabs = _tabs.map((t) => (t.id === id ? { ...t, isDirty: dirty } : t));
  _notify();
  // 右ペインの中では、未保存かどうかを、左のアプリへ知らせる (右ペインを閉じるときの確認に使う)
  if (isPaneMode()) postToParent({ type: "harmony-pane-dirty", dirty: _tabs.some((t) => t.isDirty) });
}

export function setPinned(id: string, pinned: boolean): void {
  _tabs = _tabs.map((t) => (t.id === id ? { ...t, isPinned: pinned } : t));
  _persist();
  _notify();
}

export function updateTabLabel(id: string, label: string): void {
  _tabs = _tabs.map((t) => (t.id === id ? { ...t, label } : t));
  _persist();
  _notify();
}

export function closeOtherTabs(id: string): void {
  const keep = _tabs.find((t) => t.id === id);
  const pinned = _tabs.filter((t) => t.isPinned && t.id !== id);
  const next = keep ? [...pinned, keep] : pinned;
  _rememberClosed(_tabs.filter((t) => !next.includes(t)));
  _tabs = next;
  if (!_tabs.find((t) => t.id === _activeTabId)) {
    _activeTabId = keep?.id ?? _tabs[_tabs.length - 1]?.id ?? "";
    _visit(_activeTabId);
  }
  _persist();
  _notify();
}

export function closeTabsToRight(id: string): void {
  const idx = _tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  const next = _tabs.filter((_, i) => i <= idx || _tabs[i].isPinned);
  _rememberClosed(_tabs.filter((t) => !next.includes(t)));
  _tabs = next;
  if (!_tabs.find((t) => t.id === _activeTabId)) {
    _activeTabId = id;
    _visit(id);
  }
  _persist();
  _notify();
}

// ── 閉じたタブを開き直す (UI 改善提案 続編 第 6 弾 #106) ───────────────────────────

/** 最近閉じたタブ (新しい順、最大 10 件)。いま開いているものは除く */
export function getClosedTabs(): readonly ClosedTab[] {
  return _closed.filter((c) => !_tabs.some((t) => t.id === c.id));
}

/** 閉じたタブを 1 つ開き直す (id を渡さなければ、いちばん新しいもの)。開き直せるものが無ければ null */
export function reopenClosedTab(id?: string): ClosedTab | null {
  const target = id ? getClosedTabs().find((c) => c.id === id) : getClosedTabs()[0];
  if (!target) return null;
  _closed = _closed.filter((c) => c.id !== target.id);
  try { localStorage.setItem(CLOSED_KEY, JSON.stringify(_closed)); } catch { /* ignore */ }
  openTab({ id: target.id, type: target.type, resourceId: target.resourceId, label: target.label });
  if (target.isPinned) setPinned(target.id, true);
  return target;
}

// ── 画面の履歴: 戻る / 進む (UI 改善提案 続編 第 6 弾 #107) ────────────────────────

function _stepHistory(dir: -1 | 1): boolean {
  let i = _histIdx + dir;
  // 閉じたタブは飛ばす
  while (i >= 0 && i < _hist.length && !_tabs.some((t) => t.id === _hist[i])) i += dir;
  if (i < 0 || i >= _hist.length) return false;
  _histIdx = i;
  _activeTabId = _hist[i];
  _persist();
  _notify();
  return true;
}

export function canGoBack(): boolean {
  for (let i = _histIdx - 1; i >= 0; i--) if (_tabs.some((t) => t.id === _hist[i])) return true;
  return false;
}
export function canGoForward(): boolean {
  for (let i = _histIdx + 1; i < _hist.length; i++) if (_tabs.some((t) => t.id === _hist[i])) return true;
  return false;
}
/** 直前に見ていたタブへ戻る。戻れなければ false */
export function goBackTab(): boolean { return _stepHistory(-1); }
/** 戻ったあとに、進む */
export function goForwardTab(): boolean { return _stepHistory(1); }
