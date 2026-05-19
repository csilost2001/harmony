import { useState, useMemo } from "react";
import type { ProcessFlow } from "../../types/v3";
import { computeDiff } from "./AiDiffPreviewDialogUtils";

interface AiDiffPreviewDialogProps {
  current: ProcessFlow;
  proposed: ProcessFlow;
  onApply: () => void;
  onApplySelected: (paths: string[]) => void;
  onDiscard: () => void;
  onAddMarker: (body: string) => void;
  promptSummary?: string;
}

export function AiDiffPreviewDialog({
  current,
  proposed,
  onApply,
  onApplySelected,
  onDiscard,
  onAddMarker,
  promptSummary,
}: AiDiffPreviewDialogProps) {
  const [markerMode, setMarkerMode] = useState(false);
  const [markerBody, setMarkerBody] = useState(
    `AI 提案: ${promptSummary ?? "変更を確認してください"}`,
  );

  const diff = useMemo(() => computeDiff(current, proposed), [current, proposed]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set(diff.map((entry) => entry.path)));

  const handleAddMarker = () => {
    onAddMarker(markerBody.trim() || "AI 提案の変更を確認してください");
  };

  const toggleSelectedPath = (path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <div className="process-flow-modal-overlay">
      <div className="process-flow-modal process-flow-ai-diff-dialog">
        <div className="process-flow-modal-header">
          <h3>
            <i className="bi bi-robot" />
            AI 提案 — 差分プレビュー
          </h3>
          <button type="button" className="btn btn-sm btn-link" onClick={onDiscard} title="閉じる (却下)">
            <i className="bi bi-x-lg" />
          </button>
        </div>

        {promptSummary && (
          <div className="process-flow-ai-diff-summary">
            <i className="bi bi-chat-text" />
            <span>{promptSummary}</span>
          </div>
        )}

        <div className="process-flow-ai-diff-body">
          {diff.length === 0 ? (
            <div className="process-flow-ai-diff-empty">
              <i className="bi bi-check-circle" />
              差分がありません (内容は変更されていません)
            </div>
          ) : (
            <div className="process-flow-ai-diff-list">
              {diff.map((entry, i) => (
                <div key={i} className={`process-flow-ai-diff-entry diff-${entry.kind}`}>
                  <div className="process-flow-ai-diff-path">
                    <label className="process-flow-ai-diff-select" title="この差分を選択して採用対象に含める">
                      <input
                        type="checkbox"
                        checked={selectedPaths.has(entry.path)}
                        onChange={() => toggleSelectedPath(entry.path)}
                        aria-label={`${entry.path} を採用対象にする`}
                      />
                    </label>
                    <span className={`diff-kind-badge diff-kind-badge--${entry.kind}`}>
                      {entry.kind === "added" ? "追加" : entry.kind === "removed" ? "削除" : "変更"}
                    </span>
                    <code>{entry.path}</code>
                  </div>
                  {entry.before !== undefined && (
                    <div className="process-flow-ai-diff-before">
                      <span className="diff-label">変更前</span>
                      <pre className="diff-code diff-code--before">{entry.before}</pre>
                    </div>
                  )}
                  {entry.after !== undefined && (
                    <div className="process-flow-ai-diff-after">
                      <span className="diff-label">変更後</span>
                      <pre className="diff-code diff-code--after">{entry.after}</pre>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {markerMode && (
          <div className="process-flow-ai-diff-marker-form">
            <label className="form-label form-label-sm">マーカー本文</label>
            <textarea
              className="form-control form-control-sm"
              rows={3}
              value={markerBody}
              onChange={(e) => setMarkerBody(e.target.value)}
              placeholder="マーカーに記録する内容"
            />
          </div>
        )}

        <div className="process-flow-modal-footer">
          {!markerMode ? (
            <>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setMarkerMode(true)}
                title="この提案をマーカーとして記録し、後で確認"
              >
                <i className="bi bi-bookmark" />
                マーカー化
              </button>
              <div className="ms-auto d-flex gap-2">
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onDiscard}>
                  <i className="bi bi-x" />
                  却下
                </button>
                {diff.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => onApplySelected([...selectedPaths])}
                      disabled={selectedPaths.size === 0}
                      title="チェックした差分だけを採用"
                    >
                      <i className="bi bi-check2-square" />
                      選択して採用
                    </button>
                    <button type="button" className="btn btn-sm btn-primary" onClick={onApply}>
                      <i className="bi bi-check2-all" />
                      すべて採用
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => setMarkerMode(false)}
              >
                キャンセル
              </button>
              <div className="ms-auto d-flex gap-2">
                <button type="button" className="btn btn-sm btn-warning" onClick={handleAddMarker}>
                  <i className="bi bi-bookmark-check" />
                  マーカーを追加
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
