// #1388 sub-section A (Option 2 部分): Designer.tsx の commonDialogs (~145 行) を
// 独立 component に抽出し、Designer.tsx の責務を縮小する。
// 機能変更なし — JSX 構造 + 依存関係 (props) は元の commonDialogs と完全に等価。
//
// #1388 residual cleanup (PR #1395): Codex Round 1 Should-fix #2 (33-prop flat interface) を
// 解消するため、props を概念単位の grouped object に再構成。
// editMode / resume / discard / forceRelease / legacyRescue / saveConflict / serverChange /
// ai / rename の 9 グループに分解。
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

export interface DesignerEditModeProps {
  mode: EditMode;
  isSaving: boolean;
  lockedByOther: { ownerSessionId: string } | null;
  onStartEditing: () => Promise<void>;
  onSave: () => Promise<void>;
  onOpenDiscard: () => void;
  onOpenForceRelease: () => void;
  onForcedOutChoice: (choice: ForcedOutChoice) => Promise<void> | void;
  onAfterForceUnlockChoice: (choice: ForceUnlockChoice) => Promise<void> | void;
}

export interface DesignerResumeProps {
  show: boolean;
  onContinue: () => Promise<void>;
  onDiscard: () => Promise<void>;
  onCancel: () => void;
}

export interface DesignerDiscardProps {
  show: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export interface DesignerForceReleaseProps {
  show: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}

export interface DesignerLegacyRescueProps {
  show: boolean;
  onAdopt: () => Promise<void>;
  onDiscard: () => void;
}

export interface DesignerSaveConflictProps {
  conflict: ConflictInfo | null;
  onOverwrite: () => Promise<void>;
  onCancel: () => void;
}

export interface DesignerServerChangeProps {
  changed: boolean;
  onReload: () => Promise<void>;
  onDismiss: () => void;
}

export interface DesignerAiGenerateProps {
  show: boolean;
  initialPayload: unknown;
  editorKind: EditorKind;
  cssFramework: CssFramework;
  screenName?: string;
  onApply: (payload: unknown) => Promise<void>;
  onClose: () => void;
}

export interface DesignerRenameProps {
  show: boolean;
  screenId: string;
  screenName?: string;
  allScreenIds: string[];
  fetchExistingScreenIds: () => Promise<string[]>;
  onClose: () => void;
  onSuccess: (newId: string, operationId: string, extra?: { ttlMs?: number }) => void;
  undoToast:
    | { operationId: string; oldId: string; newId: string; ttlMs?: number }
    | null;
  onUndo: () => void;
  onUndoDismiss: () => void;
}

export interface DesignerDialogsProps {
  editMode: DesignerEditModeProps;
  resume: DesignerResumeProps;
  discard: DesignerDiscardProps;
  forceRelease: DesignerForceReleaseProps;
  legacyRescue: DesignerLegacyRescueProps;
  saveConflict: DesignerSaveConflictProps;
  serverChange: DesignerServerChangeProps;
  ai: DesignerAiGenerateProps;
  rename: DesignerRenameProps;
}

export function DesignerDialogs(props: DesignerDialogsProps): ReactNode {
  const { editMode, resume, discard, forceRelease, legacyRescue, saveConflict, serverChange, ai, rename } = props;
  return (
    <>
      {/* 編集モードツールバー */}
      <EditModeToolbar
        mode={editMode.mode}
        onStartEditing={editMode.onStartEditing}
        onSave={editMode.onSave}
        onDiscardClick={editMode.onOpenDiscard}
        onForceReleaseClick={editMode.onOpenForceRelease}
        saving={editMode.isSaving}
        ownerLabel={editMode.lockedByOther?.ownerSessionId}
      />

      {/* 強制解除 / ForcedOut / AfterForceUnlock ダイアログ */}
      {editMode.mode.kind === "force-released-pending" && (
        <ForcedOutChoiceDialog
          previousDraftExists={editMode.mode.previousDraftExists}
          onChoice={editMode.onForcedOutChoice}
        />
      )}
      {editMode.mode.kind === "after-force-unlock" && (
        <AfterForceUnlockChoiceDialog
          previousOwner={editMode.mode.previousOwner}
          onChoice={editMode.onAfterForceUnlockChoice}
        />
      )}

      {resume.show && (
        <ResumeOrDiscardDialog
          onResume={resume.onContinue}
          onDiscard={resume.onDiscard}
          onCancel={resume.onCancel}
        />
      )}

      {discard.show && (
        <DiscardConfirmDialog
          onConfirm={discard.onConfirm}
          onCancel={discard.onCancel}
        />
      )}

      {forceRelease.show && editMode.lockedByOther && (
        <ForceReleaseConfirmDialog
          ownerSessionId={editMode.lockedByOther.ownerSessionId}
          onConfirm={forceRelease.onConfirm}
          onCancel={forceRelease.onCancel}
        />
      )}

      {legacyRescue.show && (
        <LegacyRescueDialog
          onAdopt={legacyRescue.onAdopt}
          onDiscard={legacyRescue.onDiscard}
        />
      )}

      {saveConflict.conflict && (
        <SaveConflictDialog
          conflict={saveConflict.conflict}
          onOverwrite={saveConflict.onOverwrite}
          onCancel={saveConflict.onCancel}
        />
      )}

      {serverChange.changed && (
        <ServerChangeBanner
          onReload={serverChange.onReload}
          onDismiss={serverChange.onDismiss}
        />
      )}

      {ai.show && (
        <ScreenDesignAiGenerateDialog
          current={ai.initialPayload}
          editorKind={ai.editorKind}
          cssFramework={ai.cssFramework}
          screenName={ai.screenName}
          onApply={ai.onApply}
          onClose={ai.onClose}
        />
      )}

      {/* #1298 I-6 (RFC #1284): id rename refactor dialog */}
      {rename.show && (
        <RenameEntityDialog
          entityType="screen"
          currentId={rename.screenId}
          currentName={rename.screenName ?? ""}
          existingIds={rename.allScreenIds}
          // Phase J SF-α (#1298 round 5 Opus SF-1): dialog open 時の existingIds rehydration
          fetchExistingIds={rename.fetchExistingScreenIds}
          onClose={rename.onClose}
          onSuccess={rename.onSuccess}
        />
      )}

      {rename.undoToast && (
        <RenameEntityUndoToast
          operationId={rename.undoToast.operationId}
          oldId={rename.undoToast.oldId}
          newId={rename.undoToast.newId}
          ttlMs={rename.undoToast.ttlMs}
          entityLabel="画面"
          onUndo={rename.onUndo}
          onDismiss={rename.onUndoDismiss}
        />
      )}
    </>
  );
}
