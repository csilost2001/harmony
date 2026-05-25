/**
 * useRenameEntityUndoToast — rename undo toast の永続化 / 復元 hook (#1298 I-6, RFC #1284)。
 *
 * Phase L で `RenameEntityUndoToast.tsx` に同居していたが、Phase M (#1298 round 8) で:
 *   - Anti N-1 (Vite Fast Refresh 警告: component + hook 同一 file)
 *   - Codex SF-1 (sessionStorage key の wsId 非考慮)
 *   - Anti SF-2 (useEffect 内 同期 setState 警告 react-hooks/set-state-in-effect)
 * を一括解消するため別 file へ分離。
 *
 * 設計ポイント:
 *   - sessionStorage key は `harmony-rename-undo:${wsId ?? "_"}:${entityType}:${currentId}` で
 *     workspace 単位に分離。同名 entity が別 workspace に存在しても metadata が混ざらない。
 *   - useEffect 内では setState を呼ばず、reducer-pattern (prev → next) で render phase
 *     で stale state を差分検出する。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { mcpBridge } from "../../mcp/mcpBridge";
import type { RenameEntityType } from "../../utils/renameEntityMapping";

export interface RenameUndoToastState {
  operationId: string;
  oldId: string;
  newId: string;
  ttlMs?: number;
}

interface RecentUndoOperation {
  operationId: string;
  entityType: RenameEntityType;
  oldId: string;
  newId: string;
  remainingTtlMs: number;
}

/**
 * Phase M Codex SF-1 (#1298 round 8): sessionStorage key に wsId を含める。
 * wsId が undefined (legacy / non-workspace context) の場合は `_` placeholder を使う。
 */
export function renameUndoStorageKey(
  entityType: RenameEntityType,
  currentId: string,
  wsId: string | undefined,
): string {
  return `harmony-rename-undo:${wsId ?? "_"}:${entityType}:${currentId}`;
}

/**
 * Rename 後の editor unmount / reload / workspace 切替を跨いで undo capability を復元する。
 *
 * sessionStorage は browser session の ownership を保持し、server query は TTL 内で
 * operation が実在することを再確認する。Phase M で wsId scoping を追加し、ws-A の
 * rename metadata が ws-B の hook mount で silent clear される事故を防ぐ。
 */
export function useRenameEntityUndoToast(
  entityType: RenameEntityType,
  currentId: string | undefined,
  wsId: string | undefined,
): readonly [RenameUndoToastState | null, (next: RenameUndoToastState | null) => void] {
  const [toast, setToast] = useState<RenameUndoToastState | null>(null);

  // Phase M Anti SF-2 (react-hooks/set-state-in-effect): useEffect 内で同期 setState を
  // 呼ばないため、prev key の差分を ref で追跡し、変更時のみ effect で stale toast を
  // clear する。currentId が falsy になった場合の同期 reset は render phase で行う。
  const prevKeyRef = useRef<string | null>(null);
  const computedKey = currentId ? renameUndoStorageKey(entityType, currentId, wsId) : null;

  // render phase での stale state reset (key 変化時、setState ループ防止のため一度のみ)
  if (computedKey !== prevKeyRef.current) {
    // 注: setState を直接呼ぶと無限ループのリスクがあるため、ref 比較で差分のときのみ
    //     setToast を呼ぶ。ref は次 render では既に新値で初期化されているため idempotent。
    if (toast !== null) {
      setToast(null);
    }
    prevKeyRef.current = computedKey;
  }

  useEffect(() => {
    if (!currentId) {
      return;
    }
    const key = renameUndoStorageKey(entityType, currentId, wsId);
    const stored = sessionStorage.getItem(key);
    if (!stored) {
      return;
    }
    let candidate: RenameUndoToastState;
    try {
      candidate = JSON.parse(stored) as RenameUndoToastState;
    } catch {
      sessionStorage.removeItem(key);
      return;
    }

    let cancelled = false;
    const restore = () => {
      void mcpBridge.request("listRecentUndoOperations", {}).then((value) => {
        if (cancelled) return;
        const recent = Array.isArray(value) ? value as RecentUndoOperation[] : [];
        const active = recent.find((op) =>
          op.operationId === candidate.operationId &&
          op.entityType === entityType &&
          op.newId === currentId,
        );
        if (!active || active.remainingTtlMs <= 0) {
          sessionStorage.removeItem(key);
          setToast(null);
          return;
        }
        setToast({ ...candidate, ttlMs: active.remainingTtlMs });
      }).catch(() => {
        // 接続前の mount では status callback の connected 遷移で再試行する。
        if (!cancelled) setToast(null);
      });
    };
    const bridgeWithStatus = mcpBridge as typeof mcpBridge & {
      onStatusChange?: (cb: (status: string) => void) => () => void;
    };
    const unsubscribe = typeof bridgeWithStatus.onStatusChange === "function"
      ? bridgeWithStatus.onStatusChange((status) => { if (status === "connected") restore(); })
      : (() => { restore(); return undefined; })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [entityType, currentId, wsId]);

  const updateToast = useCallback((next: RenameUndoToastState | null) => {
    if (next) {
      sessionStorage.setItem(renameUndoStorageKey(entityType, next.newId, wsId), JSON.stringify(next));
    } else if (currentId) {
      sessionStorage.removeItem(renameUndoStorageKey(entityType, currentId, wsId));
    }
    setToast(next);
  }, [entityType, currentId, wsId]);

  return [toast, updateToast] as const;
}
