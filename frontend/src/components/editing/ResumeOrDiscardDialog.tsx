import { useEffect, useRef } from "react";
import "../../styles/editMode.css";

export interface ResumeOrDiscardDialogProps {
  onResume: () => void;
  onDiscard: () => void;
  onCancel: () => void;
}

export function ResumeOrDiscardDialog({ onResume, onDiscard, onCancel }: ResumeOrDiscardDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="edit-mode-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      role="presentation"
    >
      <div
        className="edit-mode-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resume-or-discard-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="edit-mode-modal-header">
          <h5 id="resume-or-discard-title" className="edit-mode-modal-title">
            未保存の編集中 draft があります
          </h5>
          <button
            type="button"
            className="btn-close"
            onClick={onCancel}
            aria-label="閉じる"
          />
        </div>
        <div className="edit-mode-modal-body">
          <p>未保存の編集中があります。続きを編集しますか？</p>
          <div className="edit-mode-modal-footer">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onCancel}
              data-testid="resume-cancel"
            >
              キャンセル
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              onClick={onDiscard}
              data-testid="resume-discard"
            >
              破棄して本体を読み込む
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onResume}
              data-testid="resume-continue"
            >
              続ける
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
