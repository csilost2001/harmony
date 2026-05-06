/**
 * 画面デザインから項目候補を抽出してチェックボックスで選択するモーダル (#323)。
 *
 * `screenItemExtractor.extractScreenItemCandidates()` で input/select/textarea を走査し、
 * ユーザーが複数選択 → 画面項目として一括追加する UX。
 */
import { useEffect, useMemo, useState } from "react";
import { mcpBridge } from "../../mcp/mcpBridge";
import { extractScreenItemCandidates, type ExtractedCandidate } from "../../utils/screenItemExtractor";

interface Props {
  open: boolean;
  screenId: string | null;
  screenName?: string;
  /** 既存項目の ID セット (重複チェック用) */
  existingIds: Set<string>;
  onClose: () => void;
  /** 選択された候補群を一括追加 */
  onAddCandidates: (candidates: ExtractedCandidate[]) => void;
}

export function ScreenItemCandidatesModal({ open, screenId, screenName, existingIds, onClose, onAddCandidates }: Props) {
  const [candidates, setCandidates] = useState<ExtractedCandidate[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !screenId) return;
    setLoading(true);
    setError(null);
    setCandidates([]);
    setSelected(new Set());
    mcpBridge.request("loadScreen", { screenId })
      .then((data) => {
        if (!data) {
          setError("画面データが取得できませんでした");
          return;
        }
        const cands = extractScreenItemCandidates(data);
        setCandidates(cands);
      })
      .catch((e) => setError(`抽出エラー: ${String(e)}`))
      .finally(() => setLoading(false));
  }, [open, screenId]);

  const newCandidateIndices = useMemo(() => {
    // 既存 ID と重複しないものだけデフォルト選択対象に
    return candidates
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.name && !existingIds.has(c.name))
      .map(({ i }) => i);
  }, [candidates, existingIds]);

  const toggle = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(newCandidateIndices));
  const clearAll = () => setSelected(new Set());

  const handleAdd = () => {
    const picked = [...selected].sort((a, b) => a - b).map((i) => candidates[i]);
    onAddCandidates(picked);
    onClose();
  };

  if (!open) return null;

  return (
    <div className="screen-item-candidates-overlay" onClick={onClose}>
      <div className="screen-item-candidates" onClick={(e) => e.stopPropagation()}>
        <div className="screen-item-candidates-header">
          <h6 className="mb-0">
            <i className="bi bi-ui-checks me-1" />
            画面デザインから追加{screenName ? `: ${screenName}` : ""}
          </h6>
          <button type="button" className="btn btn-sm btn-link" onClick={onClose} aria-label="閉じる">
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <div className="screen-item-candidates-body">
          {loading && <div className="small text-muted">読み込み中...</div>}
          {error && <div className="small text-danger">{error}</div>}
          {!loading && !error && candidates.length === 0 && (
            <div className="small text-muted">
              input / select / textarea 要素が見つかりませんでした。画面デザイナーでフォーム要素を配置してから再度お試しください。
            </div>
          )}
          {candidates.length > 0 && (
            <>
              <div className="screen-item-candidates-toolbar">
                <span className="small text-muted">
                  {candidates.length} 件検出、{newCandidateIndices.length} 件が新規 (ID 重複除く)
                </span>
                <div className="ms-auto d-flex gap-2">
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={selectAll}>
                    新規を全選択
                  </button>
                  <button type="button" className="btn btn-sm btn-outline-secondary" onClick={clearAll}>
                    選択解除
                  </button>
                </div>
              </div>
              <table className="screen-item-candidates-table">
                <colgroup>
                  <col style={{ width: 30 }} />
                  <col style={{ width: "10em" }} />
                  <col style={{ width: "4em" }} />
                  <col style={{ width: "5em" }} />
                  <col style={{ width: "12em" }} />
                  <col style={{ width: "4em" }} />
                  <col style={{ width: "5em" }} />
                  <col style={{ width: "5em" }} />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th />
                    <th>ID</th>
                    <th>tag</th>
                    <th>型</th>
                    <th>label (推定)</th>
                    <th className="text-center">必須</th>
                    <th>min</th>
                    <th>max</th>
                    <th>pattern</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c, i) => {
                    const isDup = !!c.name && existingIds.has(c.name);
                    const isChecked = selected.has(i);
                    return (
                      <tr key={i} className={isDup ? "dup" : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={isChecked}
                            onChange={() => toggle(i)}
                            disabled={isDup}
                            aria-label={`${c.name} を追加`}
                          />
                        </td>
                        <td>
                          <code>{c.name || <span className="text-muted">(無名)</span>}</code>
                          {isDup && <span className="badge bg-warning text-dark ms-1" style={{ fontSize: "0.65rem" }}>重複</span>}
                        </td>
                        <td><span className="badge bg-light text-dark">{c.tag}</span></td>
                        <td>
                          <code>
                            {typeof c.type === "string"
                              ? c.type
                              : c.type.kind === "extension"
                                ? c.type.extensionRef
                                : c.type.kind}
                          </code>
                        </td>
                        <td className="small">{c.label}</td>
                        <td className="text-center">{c.required ? "✓" : ""}</td>
                        <td>{c.minLength ?? ""}</td>
                        <td>{c.maxLength ?? ""}</td>
                        <td className="small text-muted">{c.pattern ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="screen-item-candidates-footer">
          <div className="small text-muted">選択 {selected.size} 件</div>
          <div className="ms-auto d-flex gap-2">
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>
              キャンセル
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleAdd}
              disabled={selected.size === 0}
            >
              <i className="bi bi-plus-lg me-1" />
              選択した {selected.size} 件を追加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
