/**
 * DraftHistoryModal.tsx (#893)
 *
 * EditSession の draft history (discard / transferEdit / save 時のスナップショット)
 * を一覧表示し、選択したスナップショットから新規 EditSession を作成 (復元) する modal。
 *
 * props:
 *   - resourceType: リソース種別 (process-flow / table 等)
 *   - resourceId: リソース ID
 *   - isOpen: 表示フラグ
 *   - onClose: 閉じるコールバック
 *   - onRestore: 復元完了後の callback (新規 editSessionId を受け取る)
 *
 * z-index は 1055 (edit-mode-modal-backdrop の 1050 より上) を使用 (#890 で揃えた階層)。
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { mcpBridge } from "../../mcp/mcpBridge";
import type { DraftResourceType } from "../../types/draft";
import "../../styles/editMode.css";

// ── 型 ──────────────────────────────────────────────────────────────────────

type DraftHistoryReason = "discard" | "transferEdit" | "save";

interface DraftHistoryEntry {
  historyId: string;
  timestamp: string;
  editSessionId: string;
  ownerSessionId: string;
  ownerLabel: string;
  reason: DraftHistoryReason;
  resourceType: string;
  resourceId: string;
  snapshot: unknown;
}

export interface DraftHistoryModalProps {
  resourceType: DraftResourceType;
  resourceId: string;
  isOpen: boolean;
  onClose: () => void;
  /** 復元完了後の callback。新規作成された editSessionId を渡す */
  onRestore: (editSessionId: string) => void;
}

// ── ユーティリティ ────────────────────────────────────────────────────────────

function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec} 秒前`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 時間前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 日前`;
}

function reasonLabel(reason: DraftHistoryReason): string {
  switch (reason) {
    case "discard":
      return "破棄";
    case "transferEdit":
      return "引継";
    case "save":
      return "保存";
    default:
      return reason;
  }
}

function reasonBadgeClass(reason: DraftHistoryReason): string {
  switch (reason) {
    case "discard":
      return "bg-danger";
    case "transferEdit":
      return "bg-warning text-dark";
    case "save":
      return "bg-success";
    default:
      return "bg-secondary";
  }
}

/**
 * snapshot の簡易プレビューを 1 行で生成する。
 * resourceType ごとに主要フィールドを表示。
 */
function snapshotPreview(snapshot: unknown, resourceType: string): string {
  if (snapshot === null || snapshot === undefined) return "(空)";
  if (typeof snapshot !== "object") return String(snapshot).slice(0, 60);

  const obj = snapshot as Record<string, unknown>;

  switch (resourceType) {
    case "process-flow": {
      const name = typeof obj.name === "string" ? obj.name : "";
      const actions = Array.isArray(obj.actions) ? obj.actions.length : "?";
      return name ? `「${name}」 actions: ${actions} 件` : `actions: ${actions} 件`;
    }
    case "table": {
      const name = typeof obj.name === "string" ? obj.name : "";
      const columns = Array.isArray(obj.columns) ? obj.columns.length : "?";
      return name ? `「${name}」 columns: ${columns} 件` : `columns: ${columns} 件`;
    }
    case "screen":
    case "puck-data":
    case "view-definition": {
      const name = typeof obj.name === "string" ? obj.name : "";
      const id = typeof obj.id === "string" ? obj.id : "";
      return name || id || "(スナップショット)";
    }
    default: {
      const keys = Object.keys(obj).slice(0, 3).join(", ");
      return keys ? `{${keys}}` : "(スナップショット)";
    }
  }
}

// ── DraftHistoryModal コンポーネント ──────────────────────────────────────────

export function DraftHistoryModal({
  resourceType,
  resourceId,
  isOpen,
  onClose,
  onRestore,
}: DraftHistoryModalProps) {
  const [history, setHistory] = useState<DraftHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // ── 一覧取得 ────────────────────────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await mcpBridge.request("editSession.listHistory", {
        resourceType,
        resourceId,
      }) as { history: DraftHistoryEntry[] };
      setHistory(result.history ?? []);
    } catch (e) {
      console.warn("[DraftHistoryModal] listHistory failed:", e);
      setError("履歴の取得に失敗しました。");
      setHistory([]);
    } finally {
      setLoading(false);
    }
  }, [resourceType, resourceId]);

  useEffect(() => {
    if (!isOpen) return;
    void fetchHistory();
  }, [isOpen, fetchHistory]);

  // ── Esc キーで閉じる ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) dialogRef.current?.focus();
  }, [isOpen]);

  // ── 復元 ─────────────────────────────────────────────────────────────────────
  const handleRestore = useCallback(
    async (historyId: string) => {
      if (!window.confirm("このスナップショットから新規 EditSession を作成して復元しますか?")) {
        return;
      }
      setRestoring(historyId);
      try {
        const result = await mcpBridge.request("editSession.restoreFromHistory", {
          historyId,
        }) as { editSession: { id: string } };
        const newEditSessionId = result.editSession?.id;
        if (!newEditSessionId) throw new Error("editSession.id が返りませんでした");
        onClose();
        onRestore(newEditSessionId);
      } catch (e) {
        console.error("[DraftHistoryModal] restoreFromHistory failed:", e);
        setError("復元に失敗しました: " + (e instanceof Error ? e.message : String(e)));
      } finally {
        setRestoring(null);
      }
    },
    [onClose, onRestore],
  );

  if (!isOpen) return null;

  return (
    <div
      className="edit-mode-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
      style={{ zIndex: 1055 }}
      data-testid="draft-history-modal"
    >
      <div
        className="edit-mode-modal"
        style={{ maxWidth: 640, maxHeight: "80vh", display: "flex", flexDirection: "column" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-history-modal-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        {/* ヘッダー */}
        <div className="edit-mode-modal-header">
          <h5 id="draft-history-modal-title" className="edit-mode-modal-title">
            <i className="bi bi-clock-history me-2" />
            draft 履歴 (過去 7 日間)
          </h5>
          <button
            type="button"
            className="btn-close"
            onClick={onClose}
            aria-label="閉じる"
          />
        </div>

        {/* ボディ */}
        <div className="edit-mode-modal-body" style={{ overflowY: "auto", flex: 1 }}>
          {loading && (
            <div className="text-center py-3 text-muted">
              <span className="spinner-border spinner-border-sm me-2" role="status" />
              読み込み中...
            </div>
          )}

          {error && (
            <div className="alert alert-danger py-2 mb-2" role="alert">
              {error}
            </div>
          )}

          {!loading && !error && history.length === 0 && (
            <p className="text-muted text-center py-3">
              <i className="bi bi-inbox me-2" />
              履歴がありません。
            </p>
          )}

          {!loading && history.length > 0 && (
            <ul className="list-group list-group-flush">
              {history.map((entry) => (
                <li
                  key={entry.historyId}
                  className="list-group-item px-2 py-2"
                  data-testid={`draft-history-entry-${entry.historyId}`}
                >
                  <div className="d-flex align-items-start gap-2">
                    {/* reason バッジ */}
                    <span className={`badge ${reasonBadgeClass(entry.reason)} flex-shrink-0`}>
                      {reasonLabel(entry.reason)}
                    </span>

                    {/* メイン情報 */}
                    <div className="flex-grow-1 min-w-0">
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <span className="fw-semibold small text-truncate" title={entry.ownerLabel}>
                          {entry.ownerLabel}
                        </span>
                        <span className="text-muted small">
                          {relativeTime(entry.timestamp)}
                        </span>
                      </div>
                      <div className="text-muted small text-truncate mt-1" title={snapshotPreview(entry.snapshot, resourceType)}>
                        {snapshotPreview(entry.snapshot, resourceType)}
                      </div>
                    </div>

                    {/* 復元ボタン */}
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary flex-shrink-0"
                      onClick={() => void handleRestore(entry.historyId)}
                      disabled={restoring !== null}
                      title="このスナップショットから復元"
                      data-testid={`draft-history-restore-btn-${entry.historyId}`}
                    >
                      {restoring === entry.historyId ? (
                        <span className="spinner-border spinner-border-sm" role="status" />
                      ) : (
                        <>
                          <i className="bi bi-arrow-counterclockwise me-1" />
                          復元
                        </>
                      )}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* フッター */}
        <div className="edit-mode-modal-footer">
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={onClose}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
