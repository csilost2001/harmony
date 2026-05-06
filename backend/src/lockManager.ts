import type { DraftResourceType } from "./draftStore.js";

export type LockKey = `${DraftResourceType}:${string}`;

// ── Viewer subscription types ─────────────────────────────────────────────────

export interface ViewerEntry {
  sessionId: string;
  resourceType: DraftResourceType;
  resourceId: string;
  subscribedAt: string;
}

export interface LockEntry {
  resourceType: DraftResourceType;
  resourceId: string;
  ownerSessionId: string;
  actorSessionId: string;
  acquiredAt: string;
}

export class LockConflictError extends Error {
  readonly entry: LockEntry;
  constructor(entry: LockEntry) {
    super(
      `${entry.resourceType}:${entry.resourceId} は既に ${entry.ownerSessionId} がロック中です`,
    );
    this.name = "LockConflictError";
    this.entry = entry;
  }
}

export class LockNotHeldError extends Error {
  constructor(resourceType: DraftResourceType, resourceId: string, callerSessionId: string) {
    super(
      `${resourceType}:${resourceId} のロックを ${callerSessionId} は保持していません`,
    );
    this.name = "LockNotHeldError";
  }
}

const locks = new Map<LockKey, LockEntry>();

// viewer subscriptions: Map<resourceKey, Map<sessionId, ViewerEntry>>
const viewers = new Map<LockKey, Map<string, ViewerEntry>>();

function makeKey(resourceType: DraftResourceType, resourceId: string): LockKey {
  return `${resourceType}:${resourceId}` as LockKey;
}

export function acquire(
  resourceType: DraftResourceType,
  resourceId: string,
  ownerSessionId: string,
  actorSessionId?: string,
): LockEntry {
  const key = makeKey(resourceType, resourceId);
  const existing = locks.get(key);
  if (existing) {
    throw new LockConflictError(existing);
  }
  const entry: LockEntry = {
    resourceType,
    resourceId,
    ownerSessionId,
    actorSessionId: actorSessionId ?? ownerSessionId,
    acquiredAt: new Date().toISOString(),
  };
  locks.set(key, entry);
  return entry;
}

export function release(
  resourceType: DraftResourceType,
  resourceId: string,
  callerSessionId: string,
): { released: true } {
  const key = makeKey(resourceType, resourceId);
  const existing = locks.get(key);
  if (!existing || existing.ownerSessionId !== callerSessionId) {
    throw new LockNotHeldError(resourceType, resourceId, callerSessionId);
  }
  locks.delete(key);
  return { released: true };
}

export function forceRelease(
  resourceType: DraftResourceType,
  resourceId: string,
  requesterSessionId: string,
): { released: true; previousOwner: string } {
  const key = makeKey(resourceType, resourceId);
  const existing = locks.get(key);
  const previousOwner = existing?.ownerSessionId ?? requesterSessionId;
  locks.delete(key);
  return { released: true, previousOwner };
}

export function getLock(
  resourceType: DraftResourceType,
  resourceId: string,
): LockEntry | null {
  return locks.get(makeKey(resourceType, resourceId)) ?? null;
}

export function listLocks(): LockEntry[] {
  return Array.from(locks.values());
}

export function _resetForTest(): void {
  locks.clear();
  viewers.clear();
}

// ── Viewer subscription API ───────────────────────────────────────────────────

/**
 * viewer としてリソースをサブスクライブする。
 * lock は取得しない。conflict なし、複数同時サブスクライブ可。
 * 同一 (resourceKey, sessionId) の重複登録は既存 entry を更新する。
 */
export function subscribeAsViewer(
  sessionId: string,
  resourceType: DraftResourceType,
  resourceId: string,
): ViewerEntry {
  const key = makeKey(resourceType, resourceId);
  let sessionMap = viewers.get(key);
  if (!sessionMap) {
    sessionMap = new Map();
    viewers.set(key, sessionMap);
  }
  const existing = sessionMap.get(sessionId);
  if (existing) {
    // 重複登録: subscribedAt を更新して返す
    existing.subscribedAt = new Date().toISOString();
    return existing;
  }
  const entry: ViewerEntry = {
    sessionId,
    resourceType,
    resourceId,
    subscribedAt: new Date().toISOString(),
  };
  sessionMap.set(sessionId, entry);
  return entry;
}

/**
 * viewer サブスクリプションを解除する。存在しない場合は何もしない。
 */
export function unsubscribeViewer(
  sessionId: string,
  resourceType: DraftResourceType,
  resourceId: string,
): void {
  const key = makeKey(resourceType, resourceId);
  const sessionMap = viewers.get(key);
  if (!sessionMap) return;
  sessionMap.delete(sessionId);
  if (sessionMap.size === 0) {
    viewers.delete(key);
  }
}

/**
 * 指定リソースの全 viewer エントリを返す。
 */
export function listViewers(
  resourceType: DraftResourceType,
  resourceId: string,
): ViewerEntry[] {
  const key = makeKey(resourceType, resourceId);
  const sessionMap = viewers.get(key);
  if (!sessionMap) return [];
  return Array.from(sessionMap.values());
}
