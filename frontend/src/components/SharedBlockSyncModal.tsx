import { useState, useEffect } from "react";
import { mcpBridge } from "../mcp/mcpBridge";
import { getDesignedScreens, propagateSharedBlock, type SyncResult } from "../utils/sharedBlockSync";

interface Props {
  open: boolean;
  blockId: string;
  blockLabel: string;
  content: string;
  onClose: () => void;
}

type Phase = "loading" | "confirm" | "running" | "done" | "error";

export function SharedBlockSyncModal({ open, blockId, blockLabel, content, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [screens, setScreens] = useState<Array<{ id: string; name: string }>>([]);
  const [results, setResults] = useState<SyncResult[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    setPhase("loading");
    setResults([]);
    setErrorMsg("");

    if (mcpBridge.getStatus() !== "connected") {
      setErrorMsg("MCP サーバーに接続されていません。\nbackend を起動してから再試行してください。");
      setPhase("error");
      return;
    }

    getDesignedScreens()
      .then((list) => {
        setScreens(list);
        setPhase(list.length === 0 ? "error" : "confirm");
        if (list.length === 0) setErrorMsg("デザインが保存されている画面がありません。");
      })
      .catch((e) => {
        setErrorMsg(e instanceof Error ? e.message : String(e));
        setPhase("error");
      });
  }, [open]);

  if (!open) return null;

  const handlePropagate = async () => {
    setPhase("running");
    try {
      const res = await propagateSharedBlock(blockId, content);
      setResults(res);
      setPhase("done");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setPhase("error");
    }
  };

  const totalReplaced = results.reduce((s, r) => s + r.replaced, 0);
  const errorCount = results.filter((r) => r.error).length;
  const affectedCount = results.filter((r) => r.replaced > 0).length;

  return (
    <div className="modal-overlay" onClick={phase === "running" ? undefined : onClose}>
      <div className="shared-sync-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="shared-sync-header">
          <i className="bi bi-share-fill" />
          <span>共有ブロックを全画面に反映</span>
          {phase !== "running" && (
            <button className="shortcuts-close" onClick={onClose}>
              <i className="bi bi-x-lg" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="shared-sync-body">
          <div className="shared-sync-block-name">
            <i className="bi bi-bookmark-fill" style={{ color: "#6366f1" }} />
            <span>{blockLabel}</span>
          </div>

          {phase === "loading" && (
            <div className="shared-sync-status">
              <div className="spinner-small" />
              <span>画面一覧を取得中...</span>
            </div>
          )}

          {phase === "confirm" && (
            <>
              <p className="shared-sync-desc">
                <strong>{screens.length} 画面</strong>を対象に
                <code>data-shared-block-id=&quot;{blockId}&quot;</code> を持つ要素を
                最新のブロック定義に置換します。
              </p>
              <div className="shared-sync-screen-list">
                {screens.map((s) => (
                  <div key={s.id} className="shared-sync-screen-item">
                    <i className="bi bi-display" />
                    <span>{s.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {phase === "running" && (
            <div className="shared-sync-status">
              <div className="spinner-small" />
              <span>反映中... ({screens.length} 画面)</span>
            </div>
          )}

          {phase === "done" && (
            <>
              <div className={`shared-sync-summary ${errorCount > 0 ? "warn" : "ok"}`}>
                <i className={`bi ${errorCount > 0 ? "bi-exclamation-triangle-fill" : "bi-check-circle-fill"}`} />
                <span>
                  {affectedCount} 画面・{totalReplaced} 箇所を更新しました
                  {errorCount > 0 && `（${errorCount} 画面でエラー）`}
                </span>
              </div>
              <div className="shared-sync-screen-list">
                {results.map((r) => (
                  <div key={r.screenId} className={`shared-sync-screen-item${r.error ? " has-error" : ""}`}>
                    <i className={`bi ${r.error ? "bi-x-circle-fill" : r.replaced > 0 ? "bi-check-circle-fill" : "bi-dash-circle"}`} />
                    <span>{r.screenName}</span>
                    {r.replaced > 0 && <span className="shared-sync-count">{r.replaced} 箇所</span>}
                    {r.error && <span className="shared-sync-error-text">{r.error}</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {phase === "error" && (
            <div className="shared-sync-error">
              <i className="bi bi-exclamation-triangle-fill" />
              <p>{errorMsg}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shared-sync-footer">
          {phase === "confirm" && (
            <>
              <button className="code-btn code-btn-secondary" onClick={onClose}>
                キャンセル
              </button>
              <button className="code-btn code-btn-primary" onClick={handlePropagate}>
                <i className="bi bi-share-fill" /> 反映する
              </button>
            </>
          )}
          {(phase === "done" || phase === "error") && (
            <button className="code-btn code-btn-primary" onClick={onClose}>
              閉じる
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
