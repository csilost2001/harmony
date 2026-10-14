/**
 * 画面の下に短く出す通知 (保存しました など)。どこからでも showToast で出せる。表示は ToastHost。
 * 出した通知は直近 50 件を履歴に残す (ヘッダーの通知の印から見られる)。失敗の通知には、やり直す操作 (retry) を付けられる。
 */
export type ToastKind = "success" | "info" | "error";
export interface ToastMessage {
  id: number;
  text: string;
  kind: ToastKind;
  /** 出した時刻 (ms) */
  at: number;
  /** 失敗した操作をやり直す。履歴の「再試行」と、通知の「再試行」から呼ぶ (1 回だけ) */
  retry?: () => void;
}
export interface ToastOptions { retry?: () => void }

type Listener = (t: ToastMessage) => void;
const listeners = new Set<Listener>();
let seq = 0;

export const TOAST_HISTORY_MAX = 50;
let history: ToastMessage[] = [];
let unseen = 0;
const historyListeners = new Set<() => void>();
const notifyHistory = () => { historyListeners.forEach((l) => l()); };

export function showToast(text: string, kind: ToastKind = "success", opts: ToastOptions = {}): void {
  const t: ToastMessage = { id: ++seq, text, kind, at: Date.now(), ...(opts.retry ? { retry: opts.retry } : {}) };
  history = [t, ...history].slice(0, TOAST_HISTORY_MAX);
  if (kind === "error") unseen++;
  notifyHistory();
  listeners.forEach((l) => l(t));
}

export function subscribeToasts(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** 通知の履歴 (新しい順)。同じ配列を、変わるまで返す (useSyncExternalStore 用) */
export function getToastHistory(): readonly ToastMessage[] { return history; }
/** まだ見ていない失敗の数 */
export function getUnseenErrorCount(): number { return unseen; }
export function markToastHistorySeen(): void {
  if (unseen === 0) return;
  unseen = 0;
  notifyHistory();
}
export function clearToastHistory(): void {
  history = [];
  unseen = 0;
  notifyHistory();
}
export function subscribeToastHistory(l: () => void): () => void {
  historyListeners.add(l);
  return () => { historyListeners.delete(l); };
}

/** 履歴の通知のやり直しを 1 回だけ実行する (実行した通知は、やり直しの印が消える) */
export function runToastRetry(id: number): boolean {
  const t = history.find((x) => x.id === id);
  if (!t?.retry) return false;
  const run = t.retry;
  history = history.map((x) => (x.id === id ? { ...x, retry: undefined } : x));
  notifyHistory();
  run();
  return true;
}

/** テスト用: 履歴と通し番号を初期化する */
export function _resetToastHistory(): void { history = []; unseen = 0; notifyHistory(); }

/** 通知の時刻 (HH:MM:SS) */
export function formatToastTime(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
