import { useState } from "react";
import { generateScreenDesignWithCodex } from "../../codex/screenDesignGeneration";
import type { EditorKind } from "../../utils/resolveEditorKind";

interface Props {
  current: unknown;
  editorKind: EditorKind;
  cssFramework: string;
  screenName?: string;
  onApply: (payload: unknown) => void | Promise<void>;
  onClose: () => void;
}

export function ScreenDesignAiGenerateDialog({
  current,
  editorKind,
  cssFramework,
  screenName,
  onApply,
  onClose,
}: Props) {
  const [requirement, setRequirement] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setPreview("");
    try {
      const generated = await generateScreenDesignWithCodex({
        current,
        editorKind,
        cssFramework,
        screenName,
        requirement,
        onDelta: setPreview,
      });
      await onApply(generated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="edit-mode-modal-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget && !generating) onClose(); }}>
      <div className="edit-mode-modal process-flow-ai-generate-dialog" role="dialog" aria-modal="true" aria-labelledby="screen-design-ai-generate-title">
        <div className="edit-mode-modal-header">
          <h3 id="screen-design-ai-generate-title" className="edit-mode-modal-title">
            <i className="bi bi-stars" /> 画面デザイン AI 生成
          </h3>
          <button type="button" className="btn-close" onClick={onClose} disabled={generating} aria-label="閉じる" />
        </div>
        <div className="edit-mode-modal-body">
          <label className="form-label">生成要件 *</label>
          <textarea
            className="form-control"
            rows={8}
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            placeholder="例: 顧客検索画面。上部に検索条件、下部に検索結果テーブル、右上に新規登録ボタンを配置する。"
            disabled={generating}
          />
          <p className="text-muted small mt-2 mb-0">
            出力形式: {editorKind === "puck" ? "Puck Data" : "GrapesJS projectData"} / CSS: {cssFramework}
          </p>
          {preview && (
            <details className="process-flow-ai-preview" open>
              <summary>生成中の応答</summary>
              <pre>{preview}</pre>
            </details>
          )}
          {error && <p className="text-danger small mt-2">{error}</p>}
          <div className="edit-mode-modal-footer">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onClose} disabled={generating}>
              キャンセル
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleGenerate} disabled={generating || !requirement.trim()}>
              {generating ? <><i className="bi bi-arrow-repeat" /> 生成中...</> : <><i className="bi bi-stars" /> 生成して反映</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
