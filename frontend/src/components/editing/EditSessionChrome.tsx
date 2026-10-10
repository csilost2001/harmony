/**
 * 編集セッションの共通表示: 他の保存のお知らせ・編集開始/保存/破棄のツールバー・各種確認ダイアログ。
 * useEditableDocument の `chrome` をそのまま渡す。
 */
import type { EditMode, SaveConflictInfo } from "../../hooks/useEditSession";
import { ServerChangeBanner } from "../common/ServerChangeBanner";
import { EditModeToolbar } from "./EditModeToolbar";
import { DiscardConfirmDialog, ForceReleaseConfirmDialog, ForcedOutChoiceDialog, AfterForceUnlockChoiceDialog } from "./ConfirmDialogs";
import { SaveConflictDialog } from "./SaveConflictDialog";
import { ResumeOrDiscardDialog } from "./ResumeOrDiscardDialog";
import "../../styles/editMode.css";

export interface EditSessionChromeProps {
  mode: EditMode;
  saving: boolean;
  serverChanged: boolean;
  /** 保存に失敗したときの案内 (なければ null) */
  saveError: string | null;
  onDismissSaveError: () => void;
  saveConflict: SaveConflictInfo | null;
  showDiscard: boolean;
  showForceRelease: boolean;
  showResume: boolean;
  lockedByOther: { ownerSessionId: string } | null;
  onStartEditing: () => void | Promise<void>;
  onSave: () => void;
  onDiscardClick: () => void;
  onForceReleaseClick: () => void;
  onReloadServer: () => void | Promise<void>;
  onDismissServerBanner: () => void;
  onForcedOutChoice: (c: "discard" | "continue" | "adopt") => void | Promise<void>;
  onAfterForceUnlockChoice: (c: "discard" | "adopt" | "continue") => void | Promise<void>;
  onResume: () => void | Promise<void>;
  onResumeDiscard: () => void | Promise<void>;
  onResumeCancel: () => void;
  onDiscardConfirm: () => void | Promise<void>;
  onDiscardCancel: () => void;
  onForceReleaseConfirm: () => void | Promise<void>;
  onForceReleaseCancel: () => void;
  onSaveConflictOverwrite: () => void | Promise<void>;
  onSaveConflictCancel: () => void;
}

export function EditSessionChrome(p: EditSessionChromeProps) {
  const { mode } = p;
  return (
    <>
      {p.serverChanged && <ServerChangeBanner onReload={p.onReloadServer} onDismiss={p.onDismissServerBanner} />}
      {p.saveError && (
        <p className="edit-save-error" role="alert" data-testid="edit-save-error">
          <i className="bi bi-exclamation-triangle-fill" /> {p.saveError}
          <button type="button" className="edit-save-error__close" onClick={p.onDismissSaveError} aria-label="閉じる"><i className="bi bi-x-lg" /></button>
        </p>
      )}
      <EditModeToolbar
        mode={mode}
        onStartEditing={p.onStartEditing}
        onSave={p.onSave}
        onDiscardClick={p.onDiscardClick}
        onForceReleaseClick={p.onForceReleaseClick}
        saving={p.saving}
        ownerLabel={p.lockedByOther?.ownerSessionId}
      />
      {mode.kind === "force-released-pending" && <ForcedOutChoiceDialog previousDraftExists={mode.previousDraftExists} onChoice={p.onForcedOutChoice} />}
      {mode.kind === "after-force-unlock" && <AfterForceUnlockChoiceDialog previousOwner={mode.previousOwner} onChoice={p.onAfterForceUnlockChoice} />}
      {p.showResume && <ResumeOrDiscardDialog onResume={p.onResume} onDiscard={p.onResumeDiscard} onCancel={p.onResumeCancel} />}
      {p.showDiscard && <DiscardConfirmDialog onConfirm={p.onDiscardConfirm} onCancel={p.onDiscardCancel} />}
      {p.showForceRelease && p.lockedByOther && <ForceReleaseConfirmDialog ownerSessionId={p.lockedByOther.ownerSessionId} onConfirm={p.onForceReleaseConfirm} onCancel={p.onForceReleaseCancel} />}
      {p.saveConflict && <SaveConflictDialog conflict={p.saveConflict} onOverwrite={p.onSaveConflictOverwrite} onCancel={p.onSaveConflictCancel} />}
    </>
  );
}
