import type { EditMode } from "../../hooks/useEditSession";
import "../../styles/editMode.css";

interface Props {
  mode: EditMode;
  onStartEditing: () => void;
  onSave: () => void;
  onDiscardClick: () => void;
  onForceReleaseClick: () => void;
  saving?: boolean;
  ownerLabel?: string;
}

export function EditModeToolbar({
  mode,
  onStartEditing,
  onSave,
  onDiscardClick,
  onForceReleaseClick,
  saving = false,
  ownerLabel,
}: Props) {
  if (mode.kind === "readonly") {
    return (
      <div className="edit-mode-toolbar edit-mode-toolbar--readonly">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={onStartEditing}
          data-testid="edit-mode-start"
        >
          <i className="bi bi-pencil me-1" />
          編集開始
        </button>
      </div>
    );
  }

  if (mode.kind === "editing") {
    return (
      <div className="edit-mode-toolbar edit-mode-toolbar--editing">
        <button
          type="button"
          className="btn btn-success btn-sm"
          onClick={onSave}
          disabled={saving}
          data-testid="edit-mode-save"
        >
          {saving ? (
            <>
              <i className="bi bi-hourglass-split me-1" />
              保存中...
            </>
          ) : (
            <>
              <i className="bi bi-check-lg me-1" />
              保存
            </>
          )}
        </button>
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm"
          onClick={onDiscardClick}
          disabled={saving}
          data-testid="edit-mode-discard"
        >
          <i className="bi bi-x-lg me-1" />
          破棄
        </button>
      </div>
    );
  }

  if (mode.kind === "locked-by-other") {
    const label = ownerLabel ?? mode.ownerSessionId;
    return (
      <div className="edit-mode-toolbar edit-mode-toolbar--locked">
        <span className="edit-mode-lock-info" data-testid="edit-mode-lock-info">
          <i className="bi bi-lock-fill me-1" />
          {label} が編集中
        </span>
        <button
          type="button"
          className="btn btn-warning btn-sm"
          onClick={onForceReleaseClick}
          data-testid="edit-mode-force-release"
        >
          <i className="bi bi-unlock me-1" />
          強制解除
        </button>
      </div>
    );
  }

  if (mode.kind === "force-released-pending") {
    return (
      <div className="edit-mode-toolbar edit-mode-toolbar--force-released">
        <span className="edit-mode-alert" data-testid="edit-mode-forced-out-notice">
          <i className="bi bi-exclamation-triangle-fill me-1" />
          編集権限が解除されました
        </span>
      </div>
    );
  }

  if (mode.kind === "after-force-unlock") {
    return (
      <div className="edit-mode-toolbar edit-mode-toolbar--after-force-unlock">
        <span className="edit-mode-alert" data-testid="edit-mode-after-force-unlock-notice">
          <i className="bi bi-unlock-fill me-1" />
          強制解除完了 — 引継ぎを選択してください
        </span>
      </div>
    );
  }

  return null;
}
