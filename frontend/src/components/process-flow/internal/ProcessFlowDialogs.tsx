// Phase-3 (#1145): ProcessFlowEditor.tsx の各種 confirm / save-conflict / AI 生成
// / AI レビューダイアログを 1 component に束ねた wrapper。
// state は親側 (ProcessFlowEditor) が保持、本 component は宣言的レンダリングのみ。

import type { ProcessFlow } from "../../../types/v3";
import {
  DiscardConfirmDialog,
  ForceReleaseConfirmDialog,
  ForcedOutChoiceDialog,
  AfterForceUnlockChoiceDialog,
} from "../../editing/ConfirmDialogs";
import { SaveConflictDialog } from "../../editing/SaveConflictDialog";
import { ResumeOrDiscardDialog } from "../../editing/ResumeOrDiscardDialog";
import { ServerChangeBanner } from "../../common/ServerChangeBanner";
import { ProcessFlowAiGenerateDialog } from "../ProcessFlowAiGenerateDialog";
import { ProcessFlowAiReviewDialog } from "../ProcessFlowAiReviewDialog";
import { AiDiffPreviewDialog } from "../AiDiffPreviewDialog";

export interface ProcessFlowDialogsProps {
  group: ProcessFlow | null;
  mode: import("../../../hooks/useEditSession").EditMode;
  lockedByOther: { ownerSessionId: string } | null;
  /** flags */
  showResumeDialog: boolean;
  showDiscardDialog: boolean;
  showForceReleaseDialog: boolean;
  showAiGenerateDialog: boolean;
  showAiReviewDialog: boolean;
  serverChanged: boolean;
  /** edit session actions */
  onForcedOutChoice: (choice: unknown) => void;
  onAfterForceUnlockChoice: (choice: unknown) => void;
  onResumeContinue: () => void;
  onResumeDiscard: () => void;
  onCancelResume: () => void;
  onDiscardConfirm: () => void;
  onDiscardCancel: () => void;
  onForceReleaseConfirm: () => void;
  onForceReleaseCancel: () => void;
  /** save conflict */
  saveConflict: unknown;
  onSaveConflictOverwrite: () => Promise<void>;
  onSaveConflictCancel: () => void;
  /** server banner */
  onServerReload: () => void;
  onServerDismiss: () => void;
  /** AI 生成 / レビュー */
  onCloseAiGenerate: () => void;
  onApplyAiGenerate: (next: ProcessFlow) => void;
  onCloseAiReview: () => void;
  /** AI 差分 */
  aiDiffProposed: ProcessFlow | null;
  aiPromptSummary: string;
  onApplyAiDiff: (proposed: ProcessFlow) => void;
  onApplyAiDiffSelected: (proposed: ProcessFlow, paths: string[]) => void;
  onDiscardAiDiff: () => void;
  onAddAiDiffMarker: (body: string) => void;
}

export function ProcessFlowDialogs({
  group,
  mode,
  lockedByOther,
  showResumeDialog,
  showDiscardDialog,
  showForceReleaseDialog,
  showAiGenerateDialog,
  showAiReviewDialog,
  serverChanged,
  onForcedOutChoice,
  onAfterForceUnlockChoice,
  onResumeContinue,
  onResumeDiscard,
  onCancelResume,
  onDiscardConfirm,
  onDiscardCancel,
  onForceReleaseConfirm,
  onForceReleaseCancel,
  saveConflict,
  onSaveConflictOverwrite,
  onSaveConflictCancel,
  onServerReload,
  onServerDismiss,
  onCloseAiGenerate,
  onApplyAiGenerate,
  onCloseAiReview,
  aiDiffProposed,
  aiPromptSummary,
  onApplyAiDiff,
  onApplyAiDiffSelected,
  onDiscardAiDiff,
  onAddAiDiffMarker,
}: ProcessFlowDialogsProps) {
  return (
    <>
      {mode.kind === "force-released-pending" && (
        <ForcedOutChoiceDialog
          previousDraftExists={mode.previousDraftExists}
          onChoice={onForcedOutChoice}
        />
      )}

      {mode.kind === "after-force-unlock" && (
        <AfterForceUnlockChoiceDialog
          previousOwner={mode.previousOwner}
          onChoice={onAfterForceUnlockChoice}
        />
      )}

      {showResumeDialog && (
        <ResumeOrDiscardDialog
          onResume={onResumeContinue}
          onDiscard={onResumeDiscard}
          onCancel={onCancelResume}
        />
      )}

      {showDiscardDialog && (
        <DiscardConfirmDialog onConfirm={onDiscardConfirm} onCancel={onDiscardCancel} />
      )}

      {saveConflict && (
        <SaveConflictDialog
          conflict={saveConflict}
          onOverwrite={onSaveConflictOverwrite}
          onCancel={onSaveConflictCancel}
        />
      )}

      {showForceReleaseDialog && lockedByOther && (
        <ForceReleaseConfirmDialog
          ownerSessionId={lockedByOther.ownerSessionId}
          onConfirm={onForceReleaseConfirm}
          onCancel={onForceReleaseCancel}
        />
      )}

      {serverChanged && (
        <ServerChangeBanner onReload={onServerReload} onDismiss={onServerDismiss} />
      )}

      {showAiGenerateDialog && (
        <ProcessFlowAiGenerateDialog
          current={group}
          onClose={onCloseAiGenerate}
          onApply={onApplyAiGenerate}
        />
      )}

      {showAiReviewDialog && (
        <ProcessFlowAiReviewDialog current={group} onClose={onCloseAiReview} />
      )}

      {aiDiffProposed && group && (
        <AiDiffPreviewDialog
          current={group}
          proposed={aiDiffProposed}
          promptSummary={aiPromptSummary}
          onApply={() => onApplyAiDiff(aiDiffProposed)}
          onApplySelected={(paths) => onApplyAiDiffSelected(aiDiffProposed, paths)}
          onDiscard={onDiscardAiDiff}
          onAddMarker={onAddAiDiffMarker}
        />
      )}
    </>
  );
}
