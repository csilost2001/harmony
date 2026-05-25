/**
 * RenameEntityUndoToast — rename refactor 成功直後に表示する undo toast
 * (#1298 I-6, RFC #1284)。
 *
 * - 5 分 TTL で auto-dismiss (backend in-memory undo store の TTL に合わせる)
 * - 「元に戻す」ボタンで `undoEntityRename` RPC 実行 → 親 `onUndo(restoredFiles)` callback
 * - close ボタンで明示 dismiss
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { mcpBridge } from "../../mcp/mcpBridge";
import "../../styles/renameEntityDialog.css";

export interface RenameEntityUndoToastProps {
  operationId: string;
  oldId: string;
  newId: string;
  entityLabel: string;
  /** undo 成功時のコールバック (URL/tab 旧 id 復帰は親の責務) */
  onUndo: () => void;
  /** toast を閉じる (undo 後 / 明示 close / TTL 切れ 共通) */
  onDismiss: () => void;
  /** TTL ms (default 5 分 = 300000) */
  ttlMs?: number;
  /**
   * undo RPC 完了後 `onUndo()` を呼ぶ前の小 delay (default 0ms)。
   *
   * Phase F S-1 (Codex 独立レビュー #1298): 旧 default 300ms は decorator 的な race 緩和策で
   * 決定的でない。backend handler 側で undo は originating client を broadcast から除外しない
   * ように変更したため (`wsHandlers/refactor.ts undoEntityRename`)、cache invalidation が確実に
   * originating client にも届くようになった。これにより hard delay は不要 (default 0)。
   *
   * backward compat 上 prop 自体は残す (test や特殊ケースで明示指定可)。
   *
   * 旧 S-3 (Opus 独立レビュー) の race リスク説明 (history):
   *   - undo RPC 応答後に editor が即 navigate(oldUrl) すると、同一 client 内の cache
   *     invalidation が完了する前に new→old URL の editor load が走り stale cache を読む
   *   - これを 300ms hard delay で緩和していたが、S-1 (Codex) により broadcast 自体を
   *     originating client にも届ける handshake に変更したため delay 不要
   */
  postUndoDelayMs?: number;
}

export function RenameEntityUndoToast({
  operationId,
  oldId,
  newId,
  entityLabel,
  onUndo,
  onDismiss,
  ttlMs = 5 * 60 * 1000,
  postUndoDelayMs = 0,
}: RenameEntityUndoToastProps) {
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // setTimeout のラフ型 (ブラウザは number、テスト環境では NodeJS.Timeout の可能性あり)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onDismiss();
    }, ttlMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [ttlMs, onDismiss]);

  const handleUndo = useCallback(async () => {
    if (undoing) return;
    setUndoing(true);
    setError(null);
    try {
      await mcpBridge.request("undoEntityRename", { operationId });
      // Phase F S-1: backend handler が originating client にも reload broadcast を送るよう変更
      // (`wsHandlers/refactor.ts undoEntityRename` excludeClientId 廃止) されたため、
      // hard delay は default 0。test や特殊ケースで postUndoDelayMs を明示指定したい場合は適用。
      if (postUndoDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, postUndoDelayMs));
      }
      onUndo();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setUndoing(false);
    }
  }, [undoing, operationId, onUndo, postUndoDelayMs]);

  return (
    <div className="rename-entity-undo-toast" role="status" aria-live="polite" data-testid="rename-entity-undo-toast">
      <div className="rename-entity-undo-toast__message">
        {entityLabel} の id を <code>{oldId}</code> → <code>{newId}</code> に変更しました。
        {error && (
          <>
            <br />
            <span className="text-warning small">
              <i className="bi bi-exclamation-triangle" /> undo 失敗: {error}
            </span>
          </>
        )}
      </div>
      <div className="rename-entity-undo-toast__actions">
        <button
          type="button"
          className="rename-entity-undo-toast__undo"
          onClick={() => { void handleUndo(); }}
          disabled={undoing}
          data-testid="rename-entity-undo-btn"
        >
          {undoing ? (
            <><i className="bi bi-hourglass-split" /> 戻し中…</>
          ) : (
            <><i className="bi bi-arrow-counterclockwise" /> 元に戻す</>
          )}
        </button>
        <button
          type="button"
          className="rename-entity-undo-toast__close"
          onClick={onDismiss}
          aria-label="閉じる"
          data-testid="rename-entity-undo-close"
        >
          <i className="bi bi-x-lg" />
        </button>
      </div>
    </div>
  );
}
