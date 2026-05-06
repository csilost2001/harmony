/**
 * 未永続化ドラフトパネル
 *
 * localStorage に残っているがサーバーに保存されていないドラフトを一覧表示し、
 * 「開く」（該当エディタへ遷移）「破棄」（localStorage から削除）を提供する。
 */
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listAllDrafts, clearDraft, type DraftMeta } from "../../../utils/draftStorage";
import { useWorkspacePath } from "../../../hooks/useWorkspacePath";

interface DraftView extends DraftMeta {
  kindLabel: string;
  route: string | null;
}

const KIND_META: Record<string, { label: string; rawRoute: (id: string) => string }> = {
  table: { label: "テーブル", rawRoute: (id) => `/table/edit/${id}` },
  action: { label: "処理フロー", rawRoute: (id) => `/process-flow/edit/${id}` },
  flow: { label: "画面フロー", rawRoute: () => "/screen/flow" },
};

function enrich(draft: DraftMeta, wsPath: (s: string) => string): DraftView {
  const meta = KIND_META[draft.kind];
  return {
    ...draft,
    kindLabel: meta?.label ?? draft.kind,
    route: meta ? wsPath(meta.rawRoute(draft.id)) : null,
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function shortId(id: string): string {
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

export function UnsavedDraftsPanel() {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [drafts, setDrafts] = useState<DraftView[]>([]);

  const reload = useCallback(() => {
    setDrafts(listAllDrafts().map((d) => enrich(d, wsPath)));
  }, [wsPath]);

  useEffect(() => {
    reload();
    // localStorage は他タブやエディタでの編集でも変わるため storage イベントで追随
    window.addEventListener("storage", reload);
    // 他タブからの変更以外は storage イベントが飛ばないため、定期リフレッシュで補完
    const tid = window.setInterval(reload, 5000);
    return () => {
      window.removeEventListener("storage", reload);
      clearInterval(tid);
    };
  }, [reload]);

  const handleOpen = (d: DraftView) => {
    if (d.route) navigate(d.route);
  };

  const handleDiscard = (d: DraftView) => {
    if (!confirm(`${d.kindLabel}「${shortId(d.id)}」の未保存ドラフトを破棄しますか？`)) return;
    clearDraft(d.kind, d.id);
    reload();
  };

  if (drafts.length === 0) {
    return (
      <div className="drafts-empty">
        <i className="bi bi-check-circle" />
        <span>未保存のドラフトはありません</span>
      </div>
    );
  }

  return (
    <div className="drafts-panel">
      <div className="drafts-count">
        <i className="bi bi-hourglass-split" /> {drafts.length} 件のドラフト
      </div>
      <ul className="drafts-list">
        {drafts.map((d) => (
          <li key={d.key} className="draft-row">
            <div className="draft-info">
              <span className="draft-kind">{d.kindLabel}</span>
              <code className="draft-id">{shortId(d.id)}</code>
              <span className="draft-size">{formatSize(d.size)}</span>
            </div>
            <div className="draft-actions">
              {d.route && (
                <button
                  className="draft-btn draft-btn-open"
                  onClick={() => handleOpen(d)}
                  title="該当エディタを開く"
                >
                  <i className="bi bi-box-arrow-up-right" />
                </button>
              )}
              <button
                className="draft-btn draft-btn-discard"
                onClick={() => handleDiscard(d)}
                title="このドラフトを破棄"
              >
                <i className="bi bi-trash" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
