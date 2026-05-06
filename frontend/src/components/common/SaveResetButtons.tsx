import "../../styles/saveReset.css";

interface Props {
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onReset: () => void;
  /** リセット時の確認メッセージ。空文字を渡すと確認をスキップ（デフォルトは標準メッセージ） */
  resetConfirmMessage?: string;
}

const DEFAULT_RESET_CONFIRM = "編集内容を破棄して保存済み状態に戻します。よろしいですか？";

export function SaveResetButtons({
  isDirty,
  isSaving,
  onSave,
  onReset,
  resetConfirmMessage = DEFAULT_RESET_CONFIRM,
}: Props) {
  const handleResetClick = () => {
    if (resetConfirmMessage && !window.confirm(resetConfirmMessage)) return;
    onReset();
  };

  return (
    <div className="save-reset-buttons">
      <button
        className="srb-btn srb-btn-reset"
        onClick={handleResetClick}
        disabled={!isDirty || isSaving}
        title="最後に保存した状態に戻す"
      >
        <i className="bi bi-arrow-counterclockwise" /> リセット
      </button>
      <button
        className={`srb-btn srb-btn-save${isDirty ? " dirty" : ""}`}
        onClick={onSave}
        disabled={!isDirty || isSaving}
        title="保存 (Ctrl+S)"
      >
        {isSaving
          ? <><i className="bi bi-hourglass-split" /> 保存中...</>
          : <><i className="bi bi-floppy" /> 保存</>
        }
      </button>
    </div>
  );
}
