import type { ReactNode } from "react";
import "../../styles/editorHeader.css";
import { SaveResetButtons } from "./SaveResetButtons";
import { UndoHistoryPanel } from "./UndoHistoryPanel";
import type { UndoHistoryView } from "../../hooks/useUndoableState";

export interface EditorHeaderBackLink {
  label: string;
  onClick: () => void;
  title?: string;
  icon?: string;
}

export interface EditorHeaderUndoRedo {
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** 渡すと、「変更履歴」のボタンが出る (積まれている操作の一覧と、途中へ戻る操作) */
  history?: UndoHistoryView<unknown>;
  /** 履歴の「いま」の状態 (history と一緒に渡す) */
  present?: unknown;
  onJump?: (delta: number) => void;
}

export interface EditorHeaderSaveReset {
  isDirty: boolean;
  isSaving: boolean;
  onSave: () => void;
  onReset: () => void;
  resetConfirmMessage?: string;
}

export type EditorHeaderVariant = "light" | "dark";

interface Props {
  backLink?: EditorHeaderBackLink;
  title?: ReactNode;
  centerTools?: ReactNode;
  undoRedo?: EditorHeaderUndoRedo;
  extraRight?: ReactNode;
  saveReset?: EditorHeaderSaveReset;
  variant?: EditorHeaderVariant;
}

export function EditorHeader({
  backLink,
  title,
  centerTools,
  undoRedo,
  extraRight,
  saveReset,
  variant = "light",
}: Props) {
  return (
    <header className={`editor-header editor-header-${variant}`} data-testid="editor-header">
      <div className="editor-header-left">
        {backLink && (
          <button
            type="button"
            className="editor-header-back"
            onClick={backLink.onClick}
            title={backLink.title ?? backLink.label}
            data-testid="editor-header-back"
          >
            <i className={`bi ${backLink.icon ?? "bi-arrow-left"}`} />
            <span className="editor-header-back-label">{backLink.label}</span>
          </button>
        )}
        {title !== undefined && (
          <div className="editor-header-title">{title}</div>
        )}
      </div>

      {centerTools !== undefined && (
        <div className="editor-header-center">{centerTools}</div>
      )}

      <div className="editor-header-right">
        {undoRedo && (
          <div className="editor-header-undo-redo" data-testid="editor-header-undo-redo">
            <button
              type="button"
              className="editor-header-undo-btn"
              onClick={undoRedo.onUndo}
              disabled={!undoRedo.canUndo}
              title="元に戻す (Ctrl+Z)"
              data-testid="editor-header-undo"
            >
              <i className="bi bi-arrow-counterclockwise" />
            </button>
            <button
              type="button"
              className="editor-header-undo-btn"
              onClick={undoRedo.onRedo}
              disabled={!undoRedo.canRedo}
              title="やり直し (Ctrl+Y)"
              data-testid="editor-header-redo"
            >
              <i className="bi bi-arrow-clockwise" />
            </button>
            {undoRedo.history && undoRedo.onJump && <UndoHistoryPanel history={undoRedo.history} present={undoRedo.present} onJump={undoRedo.onJump} />}
          </div>
        )}
        {extraRight !== undefined && (
          <div className="editor-header-extra">{extraRight}</div>
        )}
        {saveReset && (
          <SaveResetButtons
            isDirty={saveReset.isDirty}
            isSaving={saveReset.isSaving}
            onSave={saveReset.onSave}
            onReset={saveReset.onReset}
            resetConfirmMessage={saveReset.resetConfirmMessage}
          />
        )}
      </div>
    </header>
  );
}
