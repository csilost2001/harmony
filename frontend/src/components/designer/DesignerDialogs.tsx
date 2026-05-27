// #1388 sub-section A (Option 2 部分): Designer.tsx の commonDialogs (~145 行) を
// 独立 component に抽出し、Designer.tsx の責務を縮小する。
// 機能変更なし — JSX 構造 + 依存関係 (props) は元の commonDialogs と完全に等価。
import type { ReactNode } from "react";
import { EditModeToolbar } from "../editing/EditModeToolbar";
import { ScreenDesignAiGenerateDialog } from "../design/ScreenDesignAiGenerateDialog";
import {
  DiscardConfirmDialog,
  ForceReleaseConfirmDialog,
  ForcedOutChoiceDialog,
  AfterForceUnlockChoiceDialog,
  type ForcedOutChoice,
  type ForceUnlockChoice,
} from "../editing/ConfirmDialogs";
import { SaveConflictDialog, type ConflictInfo } from "../editing/SaveConflictDialog";
import { ResumeOrDiscardDialog } from "../editing/ResumeOrDiscardDialog";
import { RenameEntityDialog } from "../common/RenameEntityDialog";
import { RenameEntityUndoToast } from "../common/RenameEntityUndoToast";
import { ServerChangeBanner } from "../common/ServerChangeBanner";
import { LegacyRescueDialog } from "./LegacyRescueDialog";
import type { EditMode } from "../../hooks/useEditSession";
import type { CssFramework } from "../../types/v3/harmony";
import type { EditorKind } from "../../utils/resolveEditorKind";

export interface DesignerDialogsProps {
  // 編集モードツールバー + Forced 系
  mode: EditMode;
  isSaving: boolean;
  lockedByOther: { ownerSessionId: string } | null;
  onStartEditing: () => Promise<void>;
  onSave: () => Promise<void>;
  onOpenDiscard: () => void;
  onOpenForceRelease: () => void;
  onForcedOutChoice: (choice: ForcedOutChoice) => Promise<void> | void;
  onAfterForceUnlockChoice: (choice: ForceUnlockChoice) => Promise<void> | void;

  // Resume / Discard / ForceRelease ダイアログ
  showResumeDialog: boolean;
  onResumeContinue: () => Promise<void>;
  onResumeDiscard: () => Promise<void>;
  onCancelResume: () => void;

  showDiscardDialog: boolean;
  onConfirmDiscard: () => Promise<void>;
  onCancelDiscard: () => void;

  showForceReleaseDialog: boolean;
  onConfirmForceRelease: () => Promise<void>;
  onCancelForceRelease: () => void;

  // Legacy rescue
  showLegacyRescueDialog: boolean;
  onLegacyRescueAdopt: () => Promise<void>;
  onLegacyRescueDiscard: () => void;

  // Save conflict
  saveConflict: ConflictInfo | null;
  onSaveConflictOverwrite: () => Promise<void>;
  onSaveConflictCancel: () => void;

  // ServerChangeBanner
  serverChanged: boolean;
  onServerChangeReload: () => Promise<void>;
  onServerChangeDismiss: () => void;

  // AI 生成
  showAiGenerateDialog: boolean;
  aiDialogInitialPayload: unknown;
  editorKind: EditorKind;
  cssFramework: CssFramework;
  screenName?: string;
  onApplyAiGenerated: (payload: unknown) => Promise<void>;
  onCloseAiGenerate: () => void;

  // Rename
  showRenameDialog: boolean;
  screenId: string;
  allScreenIds: string[];
  fetchExistingScreenIds: () => Promise<string[]>;
  onCloseRename: () => void;
  onRenameSuccess: (newId: string, operationId: string, extra?: { ttlMs?: number }) => void;

  // Rename undo toast
  renameUndoToast:
    | { operationId: string; oldId: string; newId: string; ttlMs?: number }
    | null;
  onRenameUndo: () => void;
  onRenameUndoDismiss: () => void;
}

export function DesignerDialogs(props: DesignerDialogsProps): ReactNode {
  return (
    <>
      {/* 編集モードツールバー */}
      <EditModeToolbar
        mode={props.mode}
        onStartEditing={props.onStartEditing}
        onSave={props.onSave}
        onDiscardClick={props.onOpenDiscard}
        onForceReleaseClick={props.onOpenForceRelease}
        saving={props.isSaving}
        ownerLabel={props.lockedByOther?.ownerSessionId}
      />

      {/* 強制解除 / ForcedOut / AfterForceUnlock ダイアログ */}
      {props.mode.kind === "force-released-pending" && (
        <ForcedOutChoiceDialog
          previousDraftExists={props.mode.previousDraftExists}
          onChoice={props.onForcedOutChoice}
        />
      )}
      {props.mode.kind === "after-force-unlock" && (
        <AfterForceUnlockChoiceDialog
          previousOwner={props.mode.previousOwner}
          onChoice={props.onAfterForceUnlockChoice}
        />
      )}

      {props.showResumeDialog && (
        <ResumeOrDiscardDialog
          onResume={props.onResumeContinue}
          onDiscard={props.onResumeDiscard}
          onCancel={props.onCancelResume}
        />
      )}

      {props.showDiscardDialog && (
        <DiscardConfirmDialog
          onConfirm={props.onConfirmDiscard}
          onCancel={props.onCancelDiscard}
        />
      )}

      {props.showForceReleaseDialog && props.lockedByOther && (
        <ForceReleaseConfirmDialog
          ownerSessionId={props.lockedByOther.ownerSessionId}
          onConfirm={props.onConfirmForceRelease}
          onCancel={props.onCancelForceRelease}
        />
      )}

      {props.showLegacyRescueDialog && (
        <LegacyRescueDialog
          onAdopt={props.onLegacyRescueAdopt}
          onDiscard={props.onLegacyRescueDiscard}
        />
      )}

      {props.saveConflict && (
        <SaveConflictDialog
          conflict={props.saveConflict}
          onOverwrite={props.onSaveConflictOverwrite}
          onCancel={props.onSaveConflictCancel}
        />
      )}

      {props.serverChanged && (
        <ServerChangeBanner
          onReload={props.onServerChangeReload}
          onDismiss={props.onServerChangeDismiss}
        />
      )}

      {props.showAiGenerateDialog && (
        <ScreenDesignAiGenerateDialog
          current={props.aiDialogInitialPayload}
          editorKind={props.editorKind}
          cssFramework={props.cssFramework}
          screenName={props.screenName}
          onApply={props.onApplyAiGenerated}
          onClose={props.onCloseAiGenerate}
        />
      )}

      {/* #1298 I-6 (RFC #1284): id rename refactor dialog */}
      {props.showRenameDialog && (
        <RenameEntityDialog
          entityType="screen"
          currentId={props.screenId}
          currentName={props.screenName ?? ""}
          existingIds={props.allScreenIds}
          // Phase J SF-α (#1298 round 5 Opus SF-1): dialog open 時の existingIds rehydration
          fetchExistingIds={props.fetchExistingScreenIds}
          onClose={props.onCloseRename}
          onSuccess={props.onRenameSuccess}
        />
      )}

      {props.renameUndoToast && (
        <RenameEntityUndoToast
          operationId={props.renameUndoToast.operationId}
          oldId={props.renameUndoToast.oldId}
          newId={props.renameUndoToast.newId}
          ttlMs={props.renameUndoToast.ttlMs}
          entityLabel="画面"
          onUndo={props.onRenameUndo}
          onDismiss={props.onRenameUndoDismiss}
        />
      )}
    </>
  );
}
