import { useEffect, useRef } from "react";
import "../../styles/editMode.css";

interface ModalProps {
  onClose: () => void;
  children: React.ReactNode;
  title: string;
}

function SimpleModal({ onClose, children, title }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="edit-mode-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div
        className="edit-mode-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-mode-modal-title"
        tabIndex={-1}
        ref={dialogRef}
      >
        <div className="edit-mode-modal-header">
          <h5 id="edit-mode-modal-title" className="edit-mode-modal-title">{title}</h5>
          <button
            type="button"
            className="btn-close"
            onClick={onClose}
            aria-label="閉じる"
          />
        </div>
        <div className="edit-mode-modal-body">
          {children}
        </div>
      </div>
    </div>
  );
}

export interface DiscardConfirmDialogProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function DiscardConfirmDialog({ onConfirm, onCancel }: DiscardConfirmDialogProps) {
  return (
    <SimpleModal title="編集内容を破棄" onClose={onCancel}>
      <p>編集中の内容を破棄してよいですか？この操作は元に戻せません。</p>
      <div className="edit-mode-modal-footer">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onCancel}
          data-testid="discard-cancel"
        >
          キャンセル
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={onConfirm}
          data-testid="discard-confirm"
        >
          破棄する
        </button>
      </div>
    </SimpleModal>
  );
}

export interface ForceReleaseConfirmDialogProps {
  ownerSessionId: string;
  ownerLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ForceReleaseConfirmDialog({
  ownerSessionId,
  ownerLabel,
  onConfirm,
  onCancel,
}: ForceReleaseConfirmDialogProps) {
  const label = ownerLabel ?? ownerSessionId;
  return (
    <SimpleModal title="ロックを強制解除" onClose={onCancel}>
      <p>
        <strong>{label}</strong> が編集中のロックを強制解除しますか？
        相手の編集内容は draft として保持されます。
      </p>
      <div className="edit-mode-modal-footer">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onCancel}
          data-testid="force-release-cancel"
        >
          キャンセル
        </button>
        <button
          type="button"
          className="btn btn-warning btn-sm"
          onClick={onConfirm}
          data-testid="force-release-confirm"
        >
          強制解除する
        </button>
      </div>
    </SimpleModal>
  );
}

export type ForceUnlockChoice = "adopt" | "discard" | "continue";
export type ForcedOutChoice = "adopt" | "discard" | "continue";

export interface ForcedOutChoiceDialogProps {
  previousDraftExists: boolean;
  onChoice: (choice: ForcedOutChoice) => void;
}

export interface AfterForceUnlockChoiceDialogProps {
  previousOwner: string;
  onChoice: (choice: ForceUnlockChoice) => void;
}

export function AfterForceUnlockChoiceDialog({ previousOwner, onChoice }: AfterForceUnlockChoiceDialogProps) {
  return (
    <SimpleModal title="強制解除完了 — 引継ぎ選択" onClose={() => onChoice("discard")}>
      <p>
        <strong>{previousOwner}</strong> の編集ロックを強制解除しました。
        元の draft が保持されています。どうしますか？
      </p>
      <div className="edit-mode-modal-footer">
        <button
          type="button"
          className="btn btn-outline-danger btn-sm"
          onClick={() => onChoice("discard")}
          data-testid="after-force-unlock-discard"
        >
          破棄する
        </button>
        <button
          type="button"
          className="btn btn-outline-primary btn-sm"
          onClick={() => onChoice("adopt")}
          data-testid="after-force-unlock-adopt"
        >
          採用して編集継続
        </button>
      </div>
    </SimpleModal>
  );
}

export function ForcedOutChoiceDialog({ previousDraftExists, onChoice }: ForcedOutChoiceDialogProps) {
  return (
    <SimpleModal title="編集権限が解除されました" onClose={() => onChoice("discard")}>
      <p>
        他のユーザーがあなたの編集ロックを強制解除しました。
        {previousDraftExists && " 編集内容は draft として保持されています。"}
        どうしますか？
      </p>
      <div className="edit-mode-modal-footer">
        <button
          type="button"
          className="btn btn-outline-danger btn-sm"
          onClick={() => onChoice("discard")}
          data-testid="forced-out-discard"
        >
          破棄する
        </button>
        {previousDraftExists && (
          <button
            type="button"
            className="btn btn-outline-primary btn-sm"
            onClick={() => onChoice("adopt")}
            data-testid="forced-out-adopt"
          >
            採用する
          </button>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={() => onChoice("continue")}
          data-testid="forced-out-continue"
        >
          編集を続ける
        </button>
      </div>
    </SimpleModal>
  );
}
