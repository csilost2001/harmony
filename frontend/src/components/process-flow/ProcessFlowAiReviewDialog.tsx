import { useState } from "react";
import type { ProcessFlow } from "../../types/v3";
import { reviewProcessFlowWithCodex } from "../../codex/processFlowReview";

interface Props {
  current: ProcessFlow;
  onClose: () => void;
}

export function ProcessFlowAiReviewDialog({ current, onClose }: Props) {
  const [focus, setFocus] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const handleReview = async () => {
    setReviewing(true);
    setError(null);
    setResult("");
    try {
      const text = await reviewProcessFlowWithCodex({
        current,
        focus,
        onDelta: setResult,
      });
      setResult(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div className="edit-mode-modal-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget && !reviewing) onClose(); }}>
      <div className="edit-mode-modal process-flow-ai-review-dialog" role="dialog" aria-modal="true" aria-labelledby="process-flow-ai-review-title">
        <div className="edit-mode-modal-header">
          <h3 id="process-flow-ai-review-title" className="edit-mode-modal-title">
            <i className="bi bi-clipboard-check" /> AI レビュー
          </h3>
          <button type="button" className="btn-close" onClick={onClose} disabled={reviewing} aria-label="閉じる" />
        </div>
        <div className="edit-mode-modal-body">
          <label className="form-label">重点観点</label>
          <textarea
            className="form-control"
            rows={10}
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="例: 例外系、DB 更新のトランザクション境界、入力検証の不足を重点的に確認"
            disabled={reviewing}
          />
          {result && (
            <details className="process-flow-ai-preview" open>
              <summary>レビュー結果</summary>
              <pre>{result}</pre>
            </details>
          )}
          {error && <p className="text-danger small mt-2">{error}</p>}
          <div className="edit-mode-modal-footer">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onClose} disabled={reviewing}>
              閉じる
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleReview} disabled={reviewing}>
              {reviewing ? <><i className="bi bi-arrow-repeat" /> レビュー中...</> : <><i className="bi bi-clipboard-check" /> レビュー実行</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
