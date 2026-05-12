import { recordError } from "../utils/errorLog";
import { uiInfo } from "../utils/uiLog";

const TABS_KEY = "harmony-open-tabs";
const ACTIVE_KEY = "harmony-active-tab";

export type TabType =
  // マルチインスタンス（リソース ID 毎に独立タブ）
  | "design"          // 画面デザイナー
  | "table"           // テーブル編集
  | "action"          // 処理フロー編集
  | "process-flow"    // 処理フロー編集
  | "sequence"        // シーケンス編集 (#374)
  | "view"            // ビュー編集 (#376)
  | "view-definition" // ビュー定義編集 (#666)
  | "screen-items"    // 画面項目定義 (#318 / #696 per-screen タブ化)
  | "page-layout"     // ページレイアウト編集 (#1024)
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
  | "gadget-list";      // ガジェット一覧 (#1025)

const KNOWN_TAB_TYPES: ReadonlySet<TabType> = new Set([
  "design", "table", "process-flow", "sequence", "view", "view-definition", "screen-items", "page-layout",
  "screen-flow", "screen-list", "table-list", "er", "process-flow-list",
  "extensions", "conventions-catalog", "sequence-list", "view-list", "view-definition-list",
  "workspace-list", "tech-stack", "dashboard", "page-layout-list", "gadget-list",
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
  return true;
}

function _loadTabs(): TabItem[] {
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
  const v = localStorage.getItem(ACTIVE_KEY) ?? "";
  // 存在しないタブを指していても起動時点では判断できないため文字列としてだけ検証
  return typeof v === "string" ? v : "";
}

function _persist() {
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
  _listeners.clear();
}

/** テスト専用: localStorage から再ロードする（起動時のロード挙動を検証するため） */
export function _reloadFromStorageForTests(): void {
  _tabs = _loadTabs();
  _activeTabId = _loadActiveId();
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
  } else {
    _tabs = [..._tabs, { ...item, isDirty: false, isPinned: false }];
    _activeTabId = item.id;
  }
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

  if (_activeTabId === id) {
    _activeTabId = newTabs[Math.min(idx, newTabs.length - 1)]?.id ?? "";
  }
  _persist();
  _notify();
  return true;
}

export function setActiveTab(id: string): void {
  if (_activeTabId === id) return;
  uiInfo("tabsync", "setActiveTab", { from: _activeTabId, to: id });
  _activeTabId = id;
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

export function setDirty(id: string, dirty: boolean): void {
  const tab = _tabs.find((t) => t.id === id);
  if (!tab || tab.isDirty === dirty) return;
  _tabs = _tabs.map((t) => (t.id === id ? { ...t, isDirty: dirty } : t));
  _notify();
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
  _tabs = keep ? [...pinned, keep] : pinned;
  if (!_tabs.find((t) => t.id === _activeTabId)) {
    _activeTabId = keep?.id ?? _tabs[_tabs.length - 1]?.id ?? "";
  }
  _persist();
  _notify();
}

export function closeTabsToRight(id: string): void {
  const idx = _tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  _tabs = _tabs.filter((_, i) => i <= idx || _tabs[i].isPinned);
  if (!_tabs.find((t) => t.id === _activeTabId)) {
    _activeTabId = id;
  }
  _persist();
  _notify();
}
