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
import { NOTIFY_KIND_LABELS, NOTIFY_MODE_LABELS, setNotifyPrefs, useNotifyPrefs, type NotifyMode } from "../../utils/notifyPrefs";
import "../../styles/notificationHistory.css";

const KIND_ICON: Record<ToastKind, string> = { success: "bi-check-circle-fill", error: "bi-exclamation-octagon-fill", info: "bi-info-circle-fill" };
const KIND_LABEL: Record<ToastKind, string> = { success: "成功", error: "失敗", info: "お知らせ" };

export function NotificationHistory() {
  const history = useSyncExternalStore(subscribeToastHistory, getToastHistory);
  const unseen = useSyncExternalStore(subscribeToastHistory, getUnseenErrorCount);
  const [open, setOpen] = useState(false);
  const prefs = useNotifyPrefs();
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
          <details className="notif-prefs" data-testid="notif-prefs">
            <summary>通知の受け取り方</summary>
            {(["success", "info", "error"] as const).map((k) => (
              <label key={k} className="notif-pref-row">
                <span>{NOTIFY_KIND_LABELS[k]}</span>
                <select value={prefs[k]} onChange={(e) => setNotifyPrefs({ [k]: e.target.value as NotifyMode })} aria-label={NOTIFY_KIND_LABELS[k]} data-testid={`notif-mode-${k}`}>
                  {(Object.keys(NOTIFY_MODE_LABELS) as NotifyMode[]).map((m) => <option key={m} value={m}>{NOTIFY_MODE_LABELS[m]}</option>)}
                </select>
              </label>
            ))}
            <label className="notif-pref-row">
              <span><input type="checkbox" checked={prefs.quiet.on} onChange={(e) => setNotifyPrefs({ quiet: { ...prefs.quiet, on: e.target.checked } })} data-testid="notif-quiet-on" /> 静かな時間帯 (保存・お知らせを出さない)</span>
              <span className="notif-quiet-range">
                <input type="time" value={prefs.quiet.from} disabled={!prefs.quiet.on} onChange={(e) => e.target.value && setNotifyPrefs({ quiet: { ...prefs.quiet, from: e.target.value } })} aria-label="静かな時間帯の始まり" data-testid="notif-quiet-from" />
                〜
                <input type="time" value={prefs.quiet.to} disabled={!prefs.quiet.on} onChange={(e) => e.target.value && setNotifyPrefs({ quiet: { ...prefs.quiet, to: e.target.value } })} aria-label="静かな時間帯の終わり" data-testid="notif-quiet-to" />
              </span>
            </label>
            <small>失敗の通知は、静かな時間帯でも出ます (「出さない」を選んだときを除く)。どの選び方でも、この履歴には残ります。このブラウザにだけ保存されます。</small>
          </details>
        </div>
      )}
    </span>
  );
}
