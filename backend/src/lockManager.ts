import type { DraftResourceType } from "./draftStore.js";

export type LockKey = `${DraftResourceType}:${string}`;

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
}
