import { useCallback, useEffect, useRef, useState } from "react";
import { mcpBridge } from "../mcp/mcpBridge";
import type { DraftResourceType } from "../types/draft";

export type DraftKey = `${DraftResourceType}:${string}`;

export interface UseDraftRegistryResult {
  hasDraft: (resourceType: DraftResourceType, resourceId: string) => boolean;
  drafts: Map<DraftKey, true>;
  refresh: () => Promise<void>;
}

interface DraftEntry {
  type: string;
  id: string;
  mtimeMs?: number;
}

interface DraftListResponse {
  drafts: DraftEntry[];
}

interface DraftChangedPayload {
  type: string;
  id: string;
  op: "created" | "updated" | "committed" | "discarded";
}

export function useDraftRegistry(): UseDraftRegistryResult {
  const [drafts, setDrafts] = useState<Map<DraftKey, true>>(new Map());
  const draftsRef = useRef<Map<DraftKey, true>>(new Map());

  const applyDraftList = useCallback(async (onLoaded: (next: Map<DraftKey, true>) => void) => {
    try {
      const res = await mcpBridge.request("draft.list") as DraftListResponse | null;
      const entries = res?.drafts ?? [];
      const next = new Map<DraftKey, true>();
      for (const entry of entries) {
        const key = `${entry.type}:${entry.id}` as DraftKey;
        next.set(key, true);
      }
      draftsRef.current = next;
      onLoaded(new Map(next));
    } catch {
      // MCP 未接続時は空 Map のまま
    }
  }, []);

  const refresh = useCallback(async () => {
    await applyDraftList(setDrafts);
  }, [applyDraftList]);

  useEffect(() => {
    void applyDraftList(setDrafts);
  }, [applyDraftList]);

  useEffect(() => {
    const unsub = mcpBridge.onBroadcast("draft.changed", (data) => {
      const d = data as DraftChangedPayload;
      const key = `${d.type}:${d.id}` as DraftKey;
      const next = new Map(draftsRef.current);
      if (d.op === "created" || d.op === "updated") {
        next.set(key, true);
      } else {
        next.delete(key);
      }
      draftsRef.current = next;
      setDrafts(new Map(next));
    });

    return () => {
      unsub();
    };
  }, []);

  const hasDraft = useCallback(
    (resourceType: DraftResourceType, resourceId: string): boolean => {
      const key = `${resourceType}:${resourceId}` as DraftKey;
      return draftsRef.current.has(key);
    },
    [],
  );

  return { hasDraft, drafts, refresh };
}
