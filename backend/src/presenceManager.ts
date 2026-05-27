/**
 * presenceManager.ts (#878 Phase 1 / #885 Phase 7)
 *
 * CRDT 非依存の presence/awareness 独立 channel 実装。
 * Forward-Compat 原則 ③ (presence 独立 channel) に準拠。
 * docs/spec/collab-presence.md § 4 / § 6 / § 9 を参照。
 *
 * Phase 7 追加:
 * - classifyActivity helper (presenceConfig threshold 参照)
 * - cleanupAbandoned (idleThresholdSec + WS 切断状態で削除)
 * - startCleanupInterval / stopCleanupInterval (定期実行)
 * - heartbeat の return 型に levelChanged を追加 (broadcast 効率化)
 * - list() の return 型を PresenceEntryWithLevel に変更
 */
import type { ActivityLevel } from "@harmony/shared";
import type { DraftResourceType } from "./editSessionStore.js";
import { presenceConfig } from "./presenceConfig.js";

export type { ActivityLevel };

export type PresenceRole = "editor" | "viewer";

export interface PresenceEntry {
  sessionId: string;
  resourceType: DraftResourceType;
  resourceId: string;
  role: PresenceRole;
  /** ISO 8601 — 最後のアクティビティ (kind="activity" or "edit" の heartbeat) */
  lastActivityAt: string;
  /** ISO 8601 | null — 最後の編集 (kind="edit" heartbeat)。editor のみ更新 */
  lastEditAt: string | null;
  /** ISO 8601 | null — visibility 連動。null = 切断中扱い */
  focusAt: string | null;
  /** AI 借受時の表示名。例: "@ai (alice 代行)"。通常は null */
  ownerLabel: string | null;
}

// ── Activity level (型は @harmony/shared 経由、classifyActivity は env-aware で backend 固有) ──

/**
 * PresenceEntry に server-side computed activity level を付加した型。
 * list() の返り値と presence:update broadcast の entries に使用する。
 * PresenceEntry 自体の永続構造は変更しない (制約 3 準拠)。
 */
export interface PresenceEntryWithLevel extends PresenceEntry {
  level: ActivityLevel;
}

/**
 * backend 側の classifyActivity。presenceConfig の threshold を参照する。
 * frontend の classifyActivity と同等のロジックだが threshold が env-aware。
 */
export function classifyActivity(entry: PresenceEntry, now: Date = new Date()): ActivityLevel {
  const wsAlive = entry.focusAt !== null;
  const actAge = (now.getTime() - new Date(entry.lastActivityAt).getTime()) / 1000;
  const editAge = entry.lastEditAt
    ? (now.getTime() - new Date(entry.lastEditAt).getTime()) / 1000
    : Infinity;

  if (wsAlive && editAge < presenceConfig.liveThresholdSec) return "live";
  if (wsAlive && actAge < presenceConfig.activeThresholdSec) return "active";
  if (actAge < presenceConfig.idleThresholdSec) return "idle";
  if (wsAlive) return "stale";
  return "abandoned";
}

// ── 定期 cleanup タイマー ────────────────────────────────────────────────────

let _cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * cleanupAbandoned を定期実行する setInterval を開始する。
 * backend サーバ起動時に呼ぶ。broadcast callback で presence:update を送信。
 *
 * @param broadcastFn - 削除後に呼ばれるコールバック (wsId, resourceType, resourceId, entries)
 * @param ms - 実行間隔 ms (デフォルト: presenceConfig.cleanupIntervalMs)
 */
export function startCleanupInterval(
  broadcastFn: (wsId: string, resourceType: DraftResourceType, resourceId: string, entries: PresenceEntryWithLevel[]) => void,
  ms: number = presenceConfig.cleanupIntervalMs,
): void {
  if (_cleanupTimer !== null) return; // 二重起動防止
  _cleanupTimer = setInterval(() => {
    cleanupAbandoned(broadcastFn);
  }, ms);
}

/**
 * setInterval で稼働中の cleanup タイマーを停止する。
 * テスト / shutdown 用。
 */
export function stopCleanupInterval(): void {
  if (_cleanupTimer !== null) {
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
  }
}

/** presenceManager 内部の複合キー: wsId 独立でリソースをスコープする */
type ResourceKey = `${DraftResourceType}:${string}`;

function makeResourceKey(resourceType: DraftResourceType, resourceId: string): ResourceKey {
  return `${resourceType}:${resourceId}` as ResourceKey;
}

/**
 * in-memory store: Map<wsId, Map<sessionId+resourceKey, PresenceEntry>>
 *
 * セッションが同一リソースに対して保持できるエントリは 1 件のみ。
 * 複合キー = `${sessionId}::${resourceKey}` で管理する。
 */
type EntryKey = string; // `${sessionId}::${resourceType}:${resourceId}`

function makeEntryKey(sessionId: string, resourceType: DraftResourceType, resourceId: string): EntryKey {
  return `${sessionId}::${resourceType}:${resourceId}`;
}

const store = new Map<string, Map<EntryKey, PresenceEntry>>();

function getWsMap(wsId: string): Map<EntryKey, PresenceEntry> {
  let m = store.get(wsId);
  if (!m) {
    m = new Map();
    store.set(wsId, m);
  }
  return m;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * editor として presence を登録 (lock holder)。
 * 同一 sessionId + resourceKey が既に存在する場合は role を editor に更新して返す。
 */
export function registerEditor(
  wsId: string,
  sessionId: string,
  resourceType: DraftResourceType,
  resourceId: string,
  ownerLabel?: string,
): PresenceEntry {
  const wsMap = getWsMap(wsId);
  const entryKey = makeEntryKey(sessionId, resourceType, resourceId);
  const now = new Date().toISOString();
  const existing = wsMap.get(entryKey);
  if (existing) {
    // 既存エントリを editor に更新
    existing.role = "editor";
    existing.lastActivityAt = now;
    existing.focusAt = now;
    if (ownerLabel !== undefined) existing.ownerLabel = ownerLabel ?? null;
    return existing;
  }
  const entry: PresenceEntry = {
    sessionId,
    resourceType,
    resourceId,
    role: "editor",
    lastActivityAt: now,
    lastEditAt: null,
    focusAt: now,
    ownerLabel: ownerLabel ?? null,
  };
  wsMap.set(entryKey, entry);
  return entry;
}

/**
 * viewer として presence を登録 (read-only follower)。
 * 同一 sessionId + resourceKey が既に存在する場合は role を viewer に更新して返す。
 */
export function registerViewer(
  wsId: string,
  sessionId: string,
  resourceType: DraftResourceType,
  resourceId: string,
): PresenceEntry {
  const wsMap = getWsMap(wsId);
  const entryKey = makeEntryKey(sessionId, resourceType, resourceId);
  const now = new Date().toISOString();
  const existing = wsMap.get(entryKey);
  if (existing) {
    existing.role = "viewer";
    existing.lastActivityAt = now;
    existing.focusAt = now;
    return existing;
  }
  const entry: PresenceEntry = {
    sessionId,
    resourceType,
    resourceId,
    role: "viewer",
    lastActivityAt: now,
    lastEditAt: null,
    focusAt: now,
    ownerLabel: null,
  };
  wsMap.set(entryKey, entry);
  return entry;
}

/**
 * presence を解除する。存在しない場合は何もしない。
 */
export function unregister(
  wsId: string,
  sessionId: string,
  resourceType: DraftResourceType,
  resourceId: string,
): void {
  const wsMap = store.get(wsId);
  if (!wsMap) return;
  const entryKey = makeEntryKey(sessionId, resourceType, resourceId);
  wsMap.delete(entryKey);
}

/**
 * 指定 sessionId の全 presence エントリを全 wsId にわたって削除する。
 *
 * WS 切断 (`ws.on("close")`) 時に呼び出すことで、tab close → SessionBadge 即時消滅を実現する
 * (旧来は cleanupAbandoned が `idleThresholdSec` 経過まで待つため即時消滅できなかった)。
 *
 * 戻り値: 削除された (wsId, resourceType, resourceId) の組を返す。
 * 呼び出し側で各組について `presence:update` broadcast を発火することで連携クライアントに反映する。
 */
export function unregisterAllForSession(sessionId: string): Array<{
  wsId: string;
  resourceType: DraftResourceType;
  resourceId: string;
}> {
  const removed: Array<{ wsId: string; resourceType: DraftResourceType; resourceId: string }> = [];
  for (const [wsId, wsMap] of store.entries()) {
    for (const [key, entry] of wsMap) {
      if (entry.sessionId === sessionId) {
        wsMap.delete(key);
        removed.push({ wsId, resourceType: entry.resourceType, resourceId: entry.resourceId });
      }
    }
  }
  return removed;
}

/**
 * heartbeat を受信して presence entry を更新する。
 *
 * - kind="activity": lastActivityAt = now, focusAt = now
 * - kind="edit":     lastActivityAt = now, lastEditAt = now, focusAt = now
 *
 * 返り値:
 * - changed: entry の field が更新された
 * - levelChanged: activity level が遷移した (broadcast 効率化用)
 * - entry: 更新後のエントリ
 * - level: 更新後の activity level
 *
 * Phase 7: levelChanged が false の場合は broadcast 不要。
 */
export function heartbeat(
  wsId: string,
  sessionId: string,
  resourceType: DraftResourceType,
  resourceId: string,
  kind: "activity" | "edit",
): { changed: boolean; levelChanged: boolean; entry: PresenceEntry; level: ActivityLevel } {
  const wsMap = store.get(wsId);
  if (!wsMap) {
    // 未登録セッションは activity heartbeat で auto-register (viewer として)
    const entry = registerViewer(wsId, sessionId, resourceType, resourceId);
    if (kind === "edit") entry.lastEditAt = entry.lastActivityAt;
    const level = classifyActivity(entry);
    return { changed: true, levelChanged: true, entry, level };
  }
  const entryKey = makeEntryKey(sessionId, resourceType, resourceId);
  let entry = wsMap.get(entryKey);
  if (!entry) {
    entry = registerViewer(wsId, sessionId, resourceType, resourceId);
    if (kind === "edit") entry.lastEditAt = entry.lastActivityAt;
    const level = classifyActivity(entry);
    return { changed: true, levelChanged: true, entry, level };
  }

  // 更新前の level を保持
  const prevLevel = classifyActivity(entry);

  const now = new Date().toISOString();
  entry.lastActivityAt = now;
  entry.focusAt = now;
  if (kind === "edit") {
    entry.lastEditAt = now;
  }

  const newLevel = classifyActivity(entry);
  const levelChanged = prevLevel !== newLevel;

  return { changed: true, levelChanged, entry, level: newLevel };
}

/**
 * 指定 wsId + resourceType + resourceId に対する全 presence エントリを返す。
 * Phase 7: server-side computed level を付加した PresenceEntryWithLevel[] を返す。
 * frontend は受信側で level を直接読むだけにし、classifyActivity は fallback のみ。
 */
export function list(
  wsId: string,
  resourceType: DraftResourceType,
  resourceId: string,
): PresenceEntryWithLevel[] {
  const wsMap = store.get(wsId);
  if (!wsMap) return [];
  const resourceKey = makeResourceKey(resourceType, resourceId);
  const now = new Date();
  const result: PresenceEntryWithLevel[] = [];
  for (const entry of wsMap.values()) {
    if (makeResourceKey(entry.resourceType, entry.resourceId) === resourceKey) {
      result.push({ ...entry, level: classifyActivity(entry, now) });
    }
  }
  return result;
}

/**
 * 期限切れ (stale) エントリを削除して返す。
 * `thresholdSec` より古い lastActivityAt を持つエントリを対象とする。
 * Phase 7 (#885) で cleanupAbandoned と併用。
 */
export function cleanupStale(thresholdSec: number): PresenceEntry[] {
  const removed: PresenceEntry[] = [];
  const cutoff = Date.now() - thresholdSec * 1000;
  for (const wsMap of store.values()) {
    for (const [key, entry] of wsMap) {
      const lastActivity = new Date(entry.lastActivityAt).getTime();
      if (lastActivity <= cutoff) {
        removed.push(entry);
        wsMap.delete(key);
      }
    }
  }
  return removed;
}

/**
 * WS 切断 (focusAt === null) かつ idleThresholdSec を超えたエントリを削除する。
 * Phase 7 (#885): startCleanupInterval から定期実行される。
 *
 * 削除後、影響を受けた wsId + resource ごとに broadcastFn を呼び出す。
 *
 * @param broadcastFn - 削除後コールバック (削除後の最新 entries を渡す)
 */
export function cleanupAbandoned(
  broadcastFn?: (wsId: string, resourceType: DraftResourceType, resourceId: string, entries: PresenceEntryWithLevel[]) => void,
): PresenceEntry[] {
  const removed: PresenceEntry[] = [];
  const now = new Date();
  const cutoffMs = now.getTime() - presenceConfig.idleThresholdSec * 1000;

  // 削除後にどの wsId + resource を broadcast すべきか記録
  const affectedKeys = new Map<string, { wsId: string; resourceType: DraftResourceType; resourceId: string }>();

  for (const [wsId, wsMap] of store.entries()) {
    for (const [key, entry] of wsMap) {
      // WS 切断 (focusAt === null) かつ lastActivityAt が idleThresholdSec より古い
      if (entry.focusAt === null && new Date(entry.lastActivityAt).getTime() <= cutoffMs) {
        removed.push(entry);
        wsMap.delete(key);
        // broadcast 対象として記録
        const resourceKey = makeResourceKey(entry.resourceType, entry.resourceId);
        affectedKeys.set(`${wsId}::${resourceKey}`, { wsId, resourceType: entry.resourceType, resourceId: entry.resourceId });
      }
    }
  }

  // 削除後の最新 list を broadcast
  if (broadcastFn && affectedKeys.size > 0) {
    for (const { wsId, resourceType, resourceId } of affectedKeys.values()) {
      const entries = list(wsId, resourceType, resourceId);
      broadcastFn(wsId, resourceType, resourceId, entries);
    }
  }

  // 定常的な cleanup ログは info レベルに抑制 (warn は noisy になるため使わない)
  if (removed.length > 0) {
    console.info(`[presenceManager] cleanupAbandoned: removed ${removed.length} abandoned entries`);
  }

  return removed;
}

/** テスト用: store 全体をリセット */
export function _resetForTest(): void {
  store.clear();
  stopCleanupInterval();
}
