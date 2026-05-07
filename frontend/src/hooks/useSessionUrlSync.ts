/**
 * useSessionUrlSync.ts (#902 Phase 5)
 *
 * URL `?session=<editSessionId>` の切替時反映 + ロード時復元 hook。
 * docs/spec/edit-session-protocol.md §11 (URL とブックマーク) に準拠。
 *
 * - ロード時: URLSearchParams で `?session=<editSessionId>` を解釈
 *   - 値あり → 返り値 `initialEditSessionId` に含め、consumer が attach に使う
 *   - 値なし → undefined を返す (consumer が startEditing() を判断)
 * - 切替時: history.replaceState で URL を `?session=<editSessionId>` に更新
 *   - リソース ID 部分 (パス) は変えず、?session= のみ更新
 *   - ブラウザの戻る/進むに干渉しない
 *
 * 後方互換: Phase 4 の onViewerAttached は引き続き受け付ける (Phase 6 で削除予定)
 */
import { useCallback } from "react";
import type { DraftResourceType } from "../types/draft";

// ── 型 ──────────────────────────────────────────────────────────────────────

export interface UseSessionUrlSyncOptions {
  resourceType: DraftResourceType;
  resourceId: string;
  /** viewer mode に遷移した後の callback (後方互換用, Phase 6 で削除予定) */
  onViewerAttached?: (sessionId: string) => void;
}

export interface UseSessionUrlSyncResult {
  /**
   * URL の ?session= から取得した EditSession ID。
   * 値が無い場合は undefined (= startEditing() 判断は consumer に委ねる)。
   */
  initialEditSessionId: string | undefined;
  /** 指定 editSessionId を URL に反映する (history.replaceState 経由) */
  syncSessionToUrl: (editSessionId: string) => void;
  /** URL の ?session= を削除する */
  clearSessionFromUrl: () => void;
}

// ── 実装 ─────────────────────────────────────────────────────────────────────

export function useSessionUrlSync({
  onViewerAttached,
}: UseSessionUrlSyncOptions): UseSessionUrlSyncResult {
  // ロード時: URL の ?session= を取得 (副作用なし — 純粋な読み取り)
  // NOTE: hook の呼び出し時点 (= render 時) に 1 回読み取り。
  // React StrictMode の二重呼び出しでも安全 (read-only)。
  const initialEditSessionId: string | undefined = (() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("session") ?? undefined;
  })();

  // 切替時: URL を `?session=<editSessionId>` に更新 (history.replaceState)
  const syncSessionToUrl = useCallback((editSessionId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("session", editSessionId);
    history.replaceState(null, "", url.toString());
    // 後方互換: onViewerAttached が渡されている場合は呼び出す
    onViewerAttached?.(editSessionId);
  }, [onViewerAttached]);

  // URL の ?session= を削除
  const clearSessionFromUrl = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("session");
    history.replaceState(null, "", url.toString());
  }, []);

  return { initialEditSessionId, syncSessionToUrl, clearSessionFromUrl };
}
