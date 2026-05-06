/**
 * エラー系 alert() の置き換え先。ログ表示とクリップボードコピーを含むモーダル。
 *
 * 直接 import して使うより useErrorDialog() の showError() 経由で呼ぶのが通常だが、
 * 制御状態を外から持ちたい場合はこの low-level コンポーネントを直接使う。
 */
import { useEffect } from "react";
import { ErrorDetailsPanel } from "./ErrorDetailsPanel";

export interface ErrorDialogProps {
  open: boolean;
  title: string;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
  onClose: () => void;
}

export function ErrorDialog({ open, title, message, stack, context, onClose }: ErrorDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="error-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="error-dialog-title"
      onClick={onClose}
    >
      <div className="error-dialog-panel" onClick={(e) => e.stopPropagation()}>
        <div className="error-dialog-header">
          <h2 id="error-dialog-title">
            <i className="bi bi-exclamation-triangle-fill" /> {title}
          </h2>
          <button
            type="button"
            className="error-dialog-close"
            aria-label="閉じる"
            onClick={onClose}
          >
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <div className="error-dialog-body">
          <ErrorDetailsPanel message={message} stack={stack} context={context} />
        </div>
        <div className="error-dialog-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
