/**
 * お気に入りパネル。ヘッダーの ★ / クイックオープンで固定した設計を、ダッシュボードから開く。
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../../hooks/useWorkspacePath";
import { removeFavorite, useFavorites } from "../../../utils/favorites";
import { QUICK_OPEN_KIND_ICONS, QUICK_OPEN_KIND_LABELS, buildQuickOpenEntries, resolveFavoriteEntries, type QuickOpenEntry } from "../../../utils/quickOpen";
import { loadQuickOpenSources, openQuickOpenEntry } from "../../quick-open/loadSources";
import { reportFailure } from "../../../utils/failureToast";
import { EmptyState } from "../../common/EmptyState";
import "../../../styles/favorites.css";

export function FavoritesPanel() {
  const { wsId, wsPath } = useWorkspacePath();
  const navigate = useNavigate();
  const favorites = useFavorites(wsId);
  const [entries, setEntries] = useState<QuickOpenEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    loadQuickOpenSources().then((src) => { if (alive) setEntries(buildQuickOpenEntries(src)); }).catch((e) => { reportFailure(e, "お気に入りの読み込み"); if (alive) setEntries([]); });
    return () => { alive = false; };
  }, []);

  if (favorites.length === 0) {
    return <EmptyState compact noun="お気に入り" icon="bi-star" testId="favorites-panel-empty" hint="よく使う設計を、ヘッダーの ★ やクイックオープン (Ctrl+K) の ★ で固定すると、ここから開けます。" />;
  }
  if (entries === null) return <div className="fav-panel-loading">読み込み中...</div>;
  const resolved = resolveFavoriteEntries(entries, favorites);
  return (
    <ul className="fav-panel-list" data-testid="favorites-panel">
      {resolved.map(({ key, entry }) => (
        <li key={key} className="fav-item">
          {entry ? (
            <button type="button" className="fav-open" data-testid="favorites-panel-item" onClick={() => openQuickOpenEntry(entry, navigate, wsPath)}>
              <i className={`bi ${QUICK_OPEN_KIND_ICONS[entry.kind]}`} />
              <span className="fav-label">{entry.label}</span>
              <span className="fav-kind">{QUICK_OPEN_KIND_LABELS[entry.kind]}</span>
            </button>
          ) : (
            <span className="fav-open is-missing" title="この設計は見つかりません (削除または改名された可能性があります)">
              <i className="bi bi-question-circle" />
              <span className="fav-label">{key.slice(key.indexOf(":") + 1)}</span>
              <span className="fav-kind">見つかりません</span>
            </span>
          )}
          <button type="button" className="fav-remove" aria-label={`${entry?.label ?? key}をお気に入りから外す`} title="お気に入りから外す" onClick={() => removeFavorite(wsId, key)}>
            <i className="bi bi-x-lg" />
          </button>
        </li>
      ))}
    </ul>
  );
}
