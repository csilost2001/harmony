// Phase-3 (#1145): ProcessFlowEditor.tsx の EditorHeader.extraRight に渡す
// ボタン群 (AI 生成 / AI レビュー / EditSession ドロップダウン / 描画 / 検証バッジ) を抽出。

import type { ValidationError } from "../../../utils/actionValidation";
import { EditSessionDropdown } from "../../editing/EditSessionDropdown";

export interface EditorHeaderExtrasProps {
  isReadonly: boolean;
  drawingMode: boolean;
  showWarningsPanel: boolean;
  validationErrors: ValidationError[];
  /** ProcessFlow ID (EditSessionDropdown 用) */
  processFlowId: string;
  /** EditSession 情報 */
  mode: import("../../../hooks/useEditSession").EditMode;
  sessionId: string;
  /** 各種ハンドラ */
  onOpenAiGenerate: () => void;
  onOpenAiReview: () => void;
  onToggleDrawing: () => void;
  onToggleWarnings: () => void;
  onStartEditing: () => void;
  onViewerAttached: (editSessionId: string) => void;
  onAttachAsView: (editSessionId: string) => Promise<void>;
  onTakeOver: () => Promise<void>;
}

export function EditorHeaderExtras({
  isReadonly,
  drawingMode,
  showWarningsPanel,
  validationErrors,
  processFlowId,
  mode,
  sessionId,
  onOpenAiGenerate,
  onOpenAiReview,
  onToggleDrawing,
  onToggleWarnings,
  onStartEditing,
  onViewerAttached,
  onAttachAsView,
  onTakeOver,
}: EditorHeaderExtrasProps) {
  const errorCount = validationErrors.filter((e) => e.severity === "error").length;
  const warningCount = validationErrors.filter((e) => e.severity === "warning").length;

  return (
    <>
      {!isReadonly && (
        <button
          type="button"
          className="btn btn-sm btn-outline-primary"
          onClick={onOpenAiGenerate}
          title="要件テキストから処理フロー JSON を生成"
        >
          <i className="bi bi-stars" /> AI 生成
        </button>
      )}
      <button
        type="button"
        className="btn btn-sm btn-outline-secondary"
        onClick={onOpenAiReview}
        title="現在の処理フロー JSON を AI でレビュー"
      >
        <i className="bi bi-clipboard-check" /> AI レビュー
      </button>
      <EditSessionDropdown
        resourceType="process-flow"
        resourceId={processFlowId}
        currentMode={mode}
        currentSessionId={sessionId}
        onStartEditing={onStartEditing}
        onViewerAttached={onViewerAttached}
        onAttachAsView={onAttachAsView}
        onTakeOver={onTakeOver}
      />
      <button
        type="button"
        className={`btn btn-sm ${drawingMode ? "btn-danger" : "btn-outline-secondary"}`}
        onClick={onToggleDrawing}
        title="赤線マーカー (ドラッグで描画、離すとマーカー起票)"
      >
        <i className="bi bi-pencil" /> {drawingMode ? "描画中" : "描画"}
      </button>
      {errorCount > 0 && (
        <span
          className="validation-badge error"
          title={validationErrors
            .filter((e) => e.severity === "error")
            .map((e) => (e.path ? `[${e.path}] ${e.message}` : e.message))
            .join("\n")}
        >
          <i className="bi bi-x-circle-fill" />
          {errorCount} エラー
        </span>
      )}
      {warningCount > 0 && (
        <span
          className="validation-badge warning clickable"
          title={validationErrors
            .filter((e) => e.severity === "warning")
            .slice(0, 20)
            .map((e) => (e.path ? `[${e.path}] ${e.message}` : e.message))
            .join("\n")}
          onClick={onToggleWarnings}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onToggleWarnings();
          }}
        >
          <i className="bi bi-exclamation-triangle-fill" />
          {warningCount} 警告
          <i className={`bi bi-chevron-${showWarningsPanel ? "up" : "down"} ms-1`} />
        </span>
      )}
    </>
  );
}
