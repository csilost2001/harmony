/**
 * ヘッダーのお気に入り。よく使う設計を固定しておき、どの画面からでも 1 クリックで開く。
 * いま開いている設計を、ここから追加・解除できる (クイックオープンの ★ / Ctrl+D、コマンド「お気に入りに追加」でも同じ)。
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useActiveTab } from "../../hooks/useActiveTab";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { isFavorite, removeFavorite, tabFavoriteKey, toggleFavorite, useFavorites } from "../../utils/favorites";
import { QUICK_OPEN_KIND_ICONS, QUICK_OPEN_KIND_LABELS, buildQuickOpenEntries, resolveFavoriteEntries, type QuickOpenEntry } from "../../utils/quickOpen";
import { loadQuickOpenSources, openQuickOpenEntry } from "../quick-open/loadSources";
import { reportFailure } from "../../utils/failureToast";
import "../../styles/favorites.css";

export function FavoritesMenu() {
  const { wsId, wsPath } = useWorkspacePath();
  const navigate = useNavigate();
  const favorites = useFavorites(wsId);
  const tab = useActiveTab();
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<QuickOpenEntry[] | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadQuickOpenSources().then((src) => { if (alive) setEntries(buildQuickOpenEntries(src)); }).catch((e) => { reportFailure(e, "お気に入りの読み込み"); if (alive) setEntries([]); });
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => { alive = false; document.removeEventListener("mousedown", onDown); };
  }, [open]);

  const key = tabFavoriteKey(tab);
  const on = key ? isFavorite(wsId, key) : false;
  const resolved = entries ? resolveFavoriteEntries(entries, favorites) : null;

  return (
    <span className="fav-wrap" ref={rootRef} onKeyDown={(e) => { if (open && e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" className="common-header-icon-btn" data-testid="favorites-open"
        title={`お気に入り${favorites.length ? ` (${favorites.length} 件)` : ""}`} aria-label="お気に入り" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        <i className={`bi ${on ? "bi-star-fill" : "bi-star"}`} />
      </button>
      {open && (
        <div className="fav-pop" role="dialog" aria-label="お気に入り" data-testid="favorites-pop">
          {key && tab && (
            <button type="button" className="fav-toggle" data-testid="favorites-toggle" onClick={() => toggleFavorite(wsId, key)}>
              <i className={`bi ${on ? "bi-star-fill" : "bi-star"}`} /> 「{tab.label}」を{on ? "お気に入りから外す" : "お気に入りに追加"}
            </button>
          )}
          {favorites.length === 0 ? (
            <p className="fav-empty">お気に入りはまだありません。{key ? "上のボタンで、いま開いている設計を追加できます。" : "画面・テーブルなどの設計を開いてから、ここで追加できます。"}クイックオープン (Ctrl+K) の ★ からも追加できます。</p>
          ) : resolved === null ? (
            <p className="fav-empty">読み込み中...</p>
          ) : (
            <ul className="fav-list">
              {resolved.map(({ key: k, entry }) => (
                <li key={k} className="fav-item" data-testid="favorites-item">
                  {entry ? (
                    <button type="button" className="fav-open" onClick={() => { setOpen(false); openQuickOpenEntry(entry, navigate, wsPath); }}>
                      <i className={`bi ${QUICK_OPEN_KIND_ICONS[entry.kind]}`} />
                      <span className="fav-label">{entry.label}</span>
                      <span className="fav-kind">{QUICK_OPEN_KIND_LABELS[entry.kind]}</span>
                    </button>
                  ) : (
                    <span className="fav-open is-missing" title="この設計は見つかりません (削除または改名された可能性があります)">
                      <i className="bi bi-question-circle" />
                      <span className="fav-label">{k.slice(k.indexOf(":") + 1)}</span>
                      <span className="fav-kind">見つかりません</span>
                    </span>
                  )}
                  <button type="button" className="fav-remove" aria-label={`${entry?.label ?? k}をお気に入りから外す`} title="お気に入りから外す" onClick={() => removeFavorite(wsId, k)}>
                    <i className="bi bi-x-lg" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
