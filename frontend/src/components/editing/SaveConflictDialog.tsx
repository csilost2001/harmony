/**
 * SaveConflictDialog.tsx — spec §9.3 last-save-wins 警告ダイアログ
 *
 * 複数の active EditSession が並存している状態で save を試みた際に表示される確認ダイアログ。
 * backend が `{ ok: false, conflict: { other: { ... } } }` を返した場合に useEditSession が本コンポーネントを表示する。
 *
 * data-testid="overwrite-confirm-btn" は e2e spec `multi-session-branching.spec.ts:123` が参照する。
 */

import { friendlyLabel } from "../../utils/participantLabel";
import "../../styles/editMode.css";

export interface ConflictInfo {
  editSessionId: string;
  savedBy: string;
  savedAt: string;
  displayLabel: string;
}

export interface SaveConflictDialogProps {
  conflict: ConflictInfo;
  onOverwrite: () => void;
  onCancel: () => void;
}

export function SaveConflictDialog({ conflict, onOverwrite, onCancel }: SaveConflictDialogProps) {
  const savedAtFormatted = (() => {
    try {
      const d = new Date(conflict.savedAt);
      return d.toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
    } catch {
      return conflict.savedAt;
    }
  })();

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
        aria-labelledby="save-conflict-modal-title"
        tabIndex={-1}
      >
        <div className="edit-mode-modal-header">
          <h5 id="save-conflict-modal-title" className="edit-mode-modal-title">
            上書き確認
          </h5>
          <button
            type="button"
            className="btn-close"
            onClick={onCancel}
            aria-label="閉じる"
          />
        </div>
        <div className="edit-mode-modal-body">
          <p>
            別の編集セッション (<strong>{friendlyLabel(conflict.displayLabel)}</strong>、{savedAtFormatted} 保存)
            で本体ファイルが更新されています。
          </p>
          <p>今回の保存で上書きしますか？</p>
          <p className="text-muted" style={{ fontSize: "0.85em" }}>
            ※ 上書きすると相手の保存済み内容は失われます (last-save-wins)。
          </p>
        </div>
        <div className="edit-mode-modal-footer">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onCancel}
            data-testid="save-conflict-cancel"
          >
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn-warning btn-sm"
            onClick={onOverwrite}
            data-testid="overwrite-confirm-btn"
          >
            上書きする
          </button>
        </div>
      </div>
    </div>
  );
}
