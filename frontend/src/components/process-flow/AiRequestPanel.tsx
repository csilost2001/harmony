import { useState, useRef } from "react";
import type { AiContextChip } from "../../hooks/useAiContextChips";

interface AiRequestPanelProps {
  chips: AiContextChip[];
  onRemoveChip: (id: string) => void;
  onClearChips: () => void;
  onSubmit: (prompt: string) => void;
  busy?: boolean;
  error?: string | null;
  isConnected?: boolean;
  /** ref を通じて外部から AI パネルへスクロールできるようにする */
  panelRef?: React.RefObject<HTMLDivElement | null>;
  /** アクション単位のコンテキスト追加 (#1076 受け入れ条件) */
  onAddActionContext?: () => void;
  /** フロー全体のコンテキスト追加 (#1076 受け入れ条件) */
  onAddFlowContext?: () => void;
  /** アクション追加ボタンのラベル (現アクション名) */
  actionLabel?: string;
}

const PROMPT_TEMPLATES = [
  { label: "入力検証を追加", text: "このステップに入力値の検証ロジックを追加してください。" },
  { label: "エラーハンドリング強化", text: "例外発生時のエラーハンドリングと補償処理を追加してください。" },
  { label: "詳細化", text: "処理内容をより詳細に記述してください。DB アクセスや外部システム連携の詳細を含めてください。" },
  { label: "runIf 条件追加", text: "このステップに実行条件 (runIf) を追加してください。" },
  { label: "トランザクション境界追加", text: "このステップ群をトランザクションスコープ (transactionScope step) で囲んでください。" },
  { label: "コメント補完", text: "このステップの description と notes を日本語で補完してください。" },
];

export function AiRequestPanel({
  chips,
  onRemoveChip,
  onClearChips,
  onSubmit,
  busy = false,
  error,
  isConnected = false,
  panelRef,
  onAddActionContext,
  onAddFlowContext,
  actionLabel,
}: AiRequestPanelProps) {
  const [prompt, setPrompt] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleTemplateSelect = (templateText: string) => {
    setPrompt(templateText);
    textareaRef.current?.focus();
  };

  const handleSubmit = () => {
    if (!prompt.trim() || busy || !isConnected) return;
    onSubmit(prompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      ref={panelRef}
      className="process-flow-ai-panel"
    >
      <div className="process-flow-ai-panel-header">
        <span className="process-flow-ai-panel-title">
          <i className="bi bi-robot" />
          AI 依頼
        </span>
        <span
          className={`process-flow-ai-panel-status${isConnected ? " connected" : " disconnected"}`}
          title={isConnected ? "Codex 接続済" : "Codex 未接続"}
        >
          <i className={`bi ${isConnected ? "bi-circle-fill" : "bi-circle"}`} />
          {isConnected ? "接続済" : "未接続"}
        </span>
      </div>

      {/* Context Chips */}
      {chips.length > 0 && (
        <div className="process-flow-ai-chips">
          <div className="process-flow-ai-chips-list">
            {chips.map((chip) => (
              <span key={chip.id} className={`process-flow-ai-chip process-flow-ai-chip--${chip.kind}`}>
                <i className={`bi ${chip.kind === "step" ? "bi-box" : chip.kind === "action" ? "bi-play-circle" : "bi-diagram-3"}`} />
                <span className="process-flow-ai-chip-label">{chip.label}</span>
                <button
                  type="button"
                  className="process-flow-ai-chip-remove"
                  onClick={() => onRemoveChip(chip.id)}
                  title={`${chip.label} をコンテキストから削除`}
                  aria-label={`${chip.label} を削除`}
                >
                  <i className="bi bi-x" />
                </button>
              </span>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-link btn-sm p-0 process-flow-ai-chips-clear"
            onClick={onClearChips}
            title="コンテキストをすべてクリア"
          >
            すべてクリア
          </button>
        </div>
      )}

      {/* コンテキスト追加導線 (アクション / フロー全体) */}
      {(onAddActionContext || onAddFlowContext) && (
        <div className="process-flow-ai-context-actions">
          {onAddActionContext && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onAddActionContext}
              disabled={busy}
              title={actionLabel ? `アクション「${actionLabel}」全体をコンテキストに追加` : "アクション全体をコンテキストに追加"}
            >
              <i className="bi bi-play-circle" />
              アクション全体
            </button>
          )}
          {onAddFlowContext && (
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onAddFlowContext}
              disabled={busy}
              title="フロー全体をコンテキストに追加"
            >
              <i className="bi bi-diagram-3" />
              フロー全体
            </button>
          )}
        </div>
      )}

      {/* Template Selector */}
      <div className="process-flow-ai-templates">
        <select
          className="form-select form-select-sm"
          value=""
          onChange={(e) => {
            if (e.target.value) handleTemplateSelect(e.target.value);
          }}
          disabled={busy}
          aria-label="テンプレートを選択"
        >
          <option value="">テンプレートを選択...</option>
          {PROMPT_TEMPLATES.map((t) => (
            <option key={t.label} value={t.text}>{t.label}</option>
          ))}
        </select>
      </div>

      {/* Prompt Textarea */}
      <textarea
        ref={textareaRef}
        className="form-control form-control-sm process-flow-ai-textarea"
        rows={4}
        placeholder={
          isConnected
            ? "AI への依頼内容を入力... (Ctrl+Enter で送信)"
            : "Codex に接続すると AI 依頼が使えます"
        }
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={busy}
        aria-label="AI 依頼内容"
      />

      {/* Error */}
      {error && (
        <div className="process-flow-ai-error">
          <i className="bi bi-exclamation-circle" />
          {error}
        </div>
      )}

      {/* Submit Button */}
      <div className="process-flow-ai-panel-footer">
        {chips.length === 0 && (
          <span className="process-flow-ai-no-context-hint">
            <i className="bi bi-info-circle" />
            ステップ/アクションを選択するとコンテキストが追加されます
          </span>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm process-flow-ai-submit"
          onClick={handleSubmit}
          disabled={busy || !isConnected || !prompt.trim()}
          title={!isConnected ? "Codex に接続してください" : "AI に依頼 (Ctrl+Enter)"}
        >
          {busy ? (
            <>
              <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" />
              処理中...
            </>
          ) : (
            <>
              <i className="bi bi-send" />
              送信
            </>
          )}
        </button>
      </div>
    </div>
  );
}
