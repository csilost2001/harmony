import { useState } from "react";
// #1186 Phase 2-D: types/action → types/v3 移行
import type { ProcessFlow } from "../../types/v3";
import {
  generateProcessFlowWithCodex,
  mergeGeneratedProcessFlow,
} from "../../codex/processFlowGeneration";

interface Props {
  current: ProcessFlow;
  onApply: (next: ProcessFlow) => void;
  onClose: () => void;
}

export function ProcessFlowAiGenerateDialog({ current, onApply, onClose }: Props) {
  const [requirement, setRequirement] = useState("");
  const [preview, setPreview] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleGenerate = async () => {
    setBusy(true);
    setError(null);
    setPreview("");
    try {
      const generated = await generateProcessFlowWithCodex({
        current,
        requirement,
        onDelta: setPreview,
      });
      onApply(mergeGeneratedProcessFlow(current, generated));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="process-flow-modal-overlay">
      <div className="process-flow-modal process-flow-ai-generate-dialog">
        <div className="process-flow-modal-header">
          <h3><i className="bi bi-robot" /> AI 生成</h3>
          <button type="button" className="btn btn-sm btn-link" onClick={onClose} disabled={busy}>
            <i className="bi bi-x-lg" />
          </button>
        </div>

        <div className="form-group">
          <label className="form-label">生成要件 *</label>
          <textarea
            className="form-control"
            rows={8}
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            placeholder="例: 商品検索画面の検索ボタン押下時に、入力条件を検証して商品テーブルを検索し、結果一覧を更新する処理フローを作成"
            disabled={busy}
            autoFocus
          />
        </div>

        {preview && (
          <details className="process-flow-ai-preview" open={busy}>
            <summary>生成中の応答</summary>
            <pre>{preview}</pre>
          </details>
        )}

        {error && (
          <div className="alert alert-danger py-2">
            <i className="bi bi-exclamation-triangle-fill" /> {error}
          </div>
        )}

        <div className="process-flow-modal-footer">
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void handleGenerate()}
            disabled={busy || !requirement.trim()}
          >
            {busy ? (
              <><i className="bi bi-arrow-repeat" /> 生成中...</>
            ) : (
              <><i className="bi bi-stars" /> 生成して反映</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
