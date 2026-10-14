/**
 * ヘッダーの通知の履歴。消えた通知 (保存しました・失敗しました) を、直近 50 件まで見られる。
 * 失敗の通知には、やり直せるものだけ「再試行」が付く。まだ見ていない失敗の数を、印に出す。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  clearToastHistory, formatToastTime, getToastHistory, getUnseenErrorCount, markToastHistorySeen, runToastRetry,
  subscribeToastHistory, type ToastKind,
} from "../../utils/toast";
import { onHeaderPanelRequest } from "../../utils/headerPanels";
import "../../styles/notificationHistory.css";

const KIND_ICON: Record<ToastKind, string> = { success: "bi-check-circle-fill", error: "bi-exclamation-octagon-fill", info: "bi-info-circle-fill" };
const KIND_LABEL: Record<ToastKind, string> = { success: "成功", error: "失敗", info: "お知らせ" };

export function NotificationHistory() {
  const history = useSyncExternalStore(subscribeToastHistory, getToastHistory);
  const unseen = useSyncExternalStore(subscribeToastHistory, getUnseenErrorCount);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => onHeaderPanelRequest("notifications", () => setOpen(true)), []);

  useEffect(() => {
    if (!open) return;
    markToastHistorySeen();
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <span className="notif-wrap" ref={rootRef} onKeyDown={(e) => { if (open && e.key === "Escape") { e.stopPropagation(); setOpen(false); } }}>
      <button type="button" className="common-header-icon-btn notif-btn" data-testid="notif-open"
        title={unseen > 0 ? `通知の履歴 (見ていない失敗 ${unseen} 件)` : "通知の履歴"}
        aria-label={unseen > 0 ? `通知の履歴 (見ていない失敗 ${unseen} 件)` : "通知の履歴"}
        aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen((v) => !v)}>
        <i className="bi bi-bell" />
        {unseen > 0 && <span className="notif-badge" data-testid="notif-badge" aria-hidden="true">{unseen > 9 ? "9+" : unseen}</span>}
      </button>
      {open && (
        <div className="notif-pop" role="dialog" aria-label="通知の履歴" data-testid="notif-pop">
          <div className="notif-head">
            <strong>通知の履歴</strong>
            <button type="button" className="notif-clear" data-testid="notif-clear" disabled={history.length === 0} onClick={clearToastHistory}>すべて消す</button>
          </div>
          {history.length === 0 ? (
            <p className="notif-empty">通知はまだありません。保存や失敗のお知らせが、ここに残ります。</p>
          ) : (
            <ul className="notif-list">
              {history.map((t) => (
                <li key={t.id} className={`notif-item notif-item--${t.kind}`} data-testid="notif-item">
                  <i className={`bi ${KIND_ICON[t.kind]}`} role="img" aria-label={KIND_LABEL[t.kind]} />
                  <span className="notif-text">{t.text}</span>
                  <time className="notif-time">{formatToastTime(t.at)}</time>
                  {t.retry && <button type="button" className="notif-retry" data-testid="notif-retry" onClick={() => runToastRetry(t.id)}>再試行</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </span>
  );
}
