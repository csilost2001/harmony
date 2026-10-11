import "../../styles/saveReset.css";

interface Props {
  isDirty: boolean;
  isSaving: boolean;
  /** 保存は、上の「編集中」の帯の「保存」に一本化した (ここには出さない)。互換のため受け取るだけ */
  onSave?: () => void;
  onReset: () => void;
  /** リセット時の確認メッセージ。空文字を渡すと確認をスキップ（デフォルトは標準メッセージ） */
  resetConfirmMessage?: string;
}

const DEFAULT_RESET_CONFIRM = "編集内容を破棄して保存済み状態に戻します。よろしいですか？";

export function SaveResetButtons({
  isDirty,
  isSaving,
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
    </div>
  );
}
