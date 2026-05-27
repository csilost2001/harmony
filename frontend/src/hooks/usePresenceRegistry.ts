/**
 * usePresenceRegistry.ts (#878 Phase 1)
 *
 * presence:update broadcast を購読し、リソース別の PresenceEntry[] を管理するフック。
 * docs/spec/collab-presence.md § 4 (アーキテクチャ) / § 9 (Activity taxonomy) に準拠。
 *
 * 参考実装: useDraftRegistry.ts (broadcast 購読 + Map 管理パターン)
 */
import { useEffect, useRef, useState } from "react";
import type { ActivityLevel } from "@harmony/shared";
import { mcpBridge } from "../mcp/mcpBridge";
import type { DraftResourceType } from "../types/draft";

export type { ActivityLevel };

// ── 型定義 (backend の PresenceEntry と同一 shape) ───────────────────────────

export type PresenceRole = "editor" | "viewer";

/**
 * PresenceEntry — backend の presenceManager.ts と同一 shape。
 * Phase 1 では frontend 側に重複定義とする。
 * 共通化は後続 Phase (shared types package 等) で行う。
 */
export interface PresenceEntry {
  sessionId: string;
  resourceType: DraftResourceType;
  resourceId: string;
  role: PresenceRole;
  /** ISO 8601 — 最後のアクティビティ */
  lastActivityAt: string;
  /** ISO 8601 | null — 最後の編集。editor のみ */
  lastEditAt: string | null;
  /** ISO 8601 | null — visibility 連動。null = 切断中扱い */
  focusAt: string | null;
  /** AI 借受時の表示名。例: "@ai (alice 代行)" */
  ownerLabel: string | null;
}

export type ResourceKey = `${DraftResourceType}:${string}`;

function makeResourceKey(resourceType: DraftResourceType, resourceId: string): ResourceKey {
  return `${resourceType}:${resourceId}` as ResourceKey;
}

interface PresenceUpdatePayload {
  resourceType: DraftResourceType;
  resourceId: string;
  entries: PresenceEntry[];
}

// ── グローバルシングルトン (HMR 安全) ─────────────────────────────────────────

/** presence Map の変更を購読するコールバック */
type PresenceChangeListener = (map: Map<ResourceKey, PresenceEntry[]>) => void;

class PresenceRegistryStore {
  private map = new Map<ResourceKey, PresenceEntry[]>();
  private listeners = new Set<PresenceChangeListener>();

  constructor() {
    this._subscribe();
  }

  private _subscribe(): void {
    // unsubscribe は HMR で store が再生成された時以外は不要。
    // store はシングルトンでページライフサイクル全体を通じて生存するため保持しない。
    mcpBridge.onBroadcast("presence:update", (data) => {
      const payload = data as PresenceUpdatePayload;
      const key = makeResourceKey(payload.resourceType, payload.resourceId);
      if (payload.entries.length === 0) {
        this.map.delete(key);
      } else {
        this.map.set(key, payload.entries);
      }
      const snapshot = new Map(this.map);
      for (const listener of this.listeners) {
        listener(snapshot);
      }
    });
  }

  addListener(listener: PresenceChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getAll(): Map<ResourceKey, PresenceEntry[]> {
    return new Map(this.map);
  }

  getFor(resourceType: DraftResourceType, resourceId: string): PresenceEntry[] {
    const key = makeResourceKey(resourceType, resourceId);
    return this.map.get(key) ?? [];
  }
}

// HMR 対応: グローバルに保持
declare global {
  interface Window {
    __presenceRegistryStore?: PresenceRegistryStore;
  }
}

function getStore(): PresenceRegistryStore {
  if (!window.__presenceRegistryStore) {
    window.__presenceRegistryStore = new PresenceRegistryStore();
  }
  return window.__presenceRegistryStore;
}

// ── Activity level 判定 (型は @harmony/shared、関数は frontend 固有の hardcode threshold) ──

/**
 * PresenceEntry の activity level を判定する純粋関数 (frontend 用)。
 * `ActivityLevel` 型は frontend / backend で共有のため `@harmony/shared` に集約済 (#1380)。
 *
 * 本関数の threshold は Phase 5 暫定の hardcode。Phase 7 (#885) で env config 化予定
 * (backend 側は既に `presenceConfig` 経由で env-aware、frontend 側は要追従)。
 */
export function classifyActivity(entry: PresenceEntry, now: Date = new Date()): ActivityLevel {
  const wsAlive = entry.focusAt !== null;
  const actAge = (now.getTime() - new Date(entry.lastActivityAt).getTime()) / 1000;
  const editAge = entry.lastEditAt
    ? (now.getTime() - new Date(entry.lastEditAt).getTime()) / 1000
    : Infinity;

  if (wsAlive && editAge < 60) return "live";
  if (wsAlive && actAge < 300) return "active";
  if (actAge < 86400) return "idle";
  if (wsAlive) return "stale";
  return "abandoned";
}

// ── Public hooks ─────────────────────────────────────────────────────────────

/**
 * 単一リソースの presence entries を購読するフック。
 * 一覧外の Editor ヘッダ等で使用する。
 */
export function usePresenceFor(
  resourceType: DraftResourceType,
  resourceId: string,
): PresenceEntry[] {
  const store = getStore();
  const [entries, setEntries] = useState<PresenceEntry[]>(() =>
    store.getFor(resourceType, resourceId),
  );
  const resourceTypeRef = useRef(resourceType);
  const resourceIdRef = useRef(resourceId);

  useEffect(() => {
    resourceTypeRef.current = resourceType;
    resourceIdRef.current = resourceId;
  }, [resourceType, resourceId]);

  useEffect(() => {
    const unsub = store.addListener((map) => {
      const key = makeResourceKey(resourceTypeRef.current, resourceIdRef.current);
      setEntries(map.get(key) ?? []);
    });
    // 初期値を最新に同期
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial presence snapshot is read from the external store.
    setEntries(store.getFor(resourceType, resourceId));
    return unsub;
  }, [store, resourceType, resourceId]);

  return entries;
}

/**
 * 全リソースの presence Map を購読するフック。
 * 一覧画面 (Phase 5 で利用) 等の全件表示用。
 */
export function usePresenceAll(): Map<ResourceKey, PresenceEntry[]> {
  const store = getStore();
  const [map, setMap] = useState<Map<ResourceKey, PresenceEntry[]>>(() => store.getAll());

  useEffect(() => {
    const unsub = store.addListener((next) => {
      setMap(new Map(next));
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial presence map is read from the external store.
    setMap(store.getAll());
    return unsub;
  }, [store]);

  return map;
}
