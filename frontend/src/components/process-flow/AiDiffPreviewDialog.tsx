import { useState, useMemo } from "react";
import type { ProcessFlow } from "../../types/action";

interface DiffEntry {
  path: string;
  kind: "added" | "removed" | "changed";
  before?: string;
  after?: string;
}

function computeDiff(current: ProcessFlow, proposed: ProcessFlow): DiffEntry[] {
  const entries: DiffEntry[] = [];

  // meta 比較
  const currentMeta = (current.meta ?? {}) as Record<string, unknown>;
  const proposedMeta = (proposed.meta ?? {}) as Record<string, unknown>;
  const metaKeys = new Set([...Object.keys(currentMeta), ...Object.keys(proposedMeta)]);
  for (const key of metaKeys) {
    if (key === "updatedAt") continue; // 常に変わるので無視
    const before = JSON.stringify(currentMeta[key]);
    const after = JSON.stringify(proposedMeta[key]);
    if (before !== after) {
      entries.push({
        path: `meta.${key}`,
        kind: before === undefined ? "added" : after === undefined ? "removed" : "changed",
        before,
        after,
      });
    }
  }

  // actions 比較 (action ID 単位)
  const currentActions = ((current.actions ?? []) as Array<Record<string, unknown>>);
  const proposedActions = ((proposed.actions ?? []) as Array<Record<string, unknown>>);
  const currentActionMap = new Map(currentActions.map((a) => [String(a.id), a]));
  const proposedActionMap = new Map(proposedActions.map((a) => [String(a.id), a]));

  for (const [id, action] of proposedActionMap) {
    const cur = currentActionMap.get(id);
    if (!cur) {
      entries.push({
        path: `actions[${id}]`,
        kind: "added",
        after: JSON.stringify(action, null, 2),
      });
    } else {
      const beforeStr = JSON.stringify(cur, null, 2);
      const afterStr = JSON.stringify(action, null, 2);
      if (beforeStr !== afterStr) {
        entries.push({
          path: `actions[${id}]`,
          kind: "changed",
          before: beforeStr,
          after: afterStr,
        });
      }
    }
  }
  for (const [id, action] of currentActionMap) {
    if (!proposedActionMap.has(id)) {
      entries.push({
        path: `actions[${id}]`,
        kind: "removed",
        before: JSON.stringify(action, null, 2),
      });
    }
  }

  // context 比較
  const currentCtx = JSON.stringify(current.context ?? {});
  const proposedCtx = JSON.stringify(proposed.context ?? {});
  if (currentCtx !== proposedCtx) {
    entries.push({
      path: "context",
      kind: "changed",
      before: JSON.stringify(current.context, null, 2),
      after: JSON.stringify(proposed.context, null, 2),
    });
  }

  return entries;
}

interface AiDiffPreviewDialogProps {
  current: ProcessFlow;
  proposed: ProcessFlow;
  onApply: () => void;
  onDiscard: () => void;
  onAddMarker: (body: string) => void;
  promptSummary?: string;
}

export function AiDiffPreviewDialog({
  current,
  proposed,
  onApply,
  onDiscard,
  onAddMarker,
  promptSummary,
}: AiDiffPreviewDialogProps) {
  const [markerMode, setMarkerMode] = useState(false);
  const [markerBody, setMarkerBody] = useState(
    `AI 提案: ${promptSummary ?? "変更を確認してください"}`,
  );

  const diff = useMemo(() => computeDiff(current, proposed), [current, proposed]);

  const handleAddMarker = () => {
    onAddMarker(markerBody.trim() || "AI 提案の変更を確認してください");
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
                  <button type="button" className="btn btn-sm btn-primary" onClick={onApply}>
                    <i className="bi bi-check2" />
                    採用
                  </button>
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
