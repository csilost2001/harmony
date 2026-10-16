/**
 * `.catch(console.error)` で握りつぶされた操作の失敗を、画面にも知らせる。
 * 一覧の保存・削除・複製などは、失敗してもコンソールに出るだけで、利用者には何も起きなかったように見えていた。
 * エラー 1 つだけを渡された console.error (= `.catch(console.error)` の形) を、通知として出す。
 * 説明文つきの console.error (引数が複数) は、開発者向けのログなので、通知にしない。
 */
import { isConnectionError } from "./connectionError";
import { showToast } from "./toast";
import { focusFirstIssue } from "./pageIssues";

/** 同じ内容の通知を続けて出さない間隔 */
const SAME_MESSAGE_MS = 5000;

/** 失敗の中身 (利用者向け)。サーバ側の ID 検査の英語のメッセージは、日本語にする。中身が無ければ空 */
function failureDetail(e: Error): string {
  const msg = (e.message || "").trim();
  if (/^Invalid \w+: must be kebab-case/.test(msg)) return "ID の形式が正しくありません (英小文字で始まり、英小文字・数字・ハイフンだけ。64 字まで)";
  return msg;
}

/** 通知にする失敗の文言。通知にしない失敗 (中断など) は null */
export function failureToastText(args: readonly unknown[]): string | null {
  if (args.length !== 1) return null;
  const e = args[0];
  if (!(e instanceof Error)) return null;
  if (e.name === "AbortError") return null;
  if (isConnectionError(e)) return "サーバに接続できないため、操作できませんでした";
  const detail = failureDetail(e);
  return detail ? `操作に失敗しました: ${detail}` : "操作に失敗しました";
}

/** テスト用: 通知の重複抑制を初期化する */
export function _resetFailureToastDedupe(): void { lastShown.clear(); }

/** 同じ文言の通知を続けて出さない (サーバが落ちているときに、同時に何件も失敗しても 1 回だけ) */
const lastShown = new Map<string, number>();
function showFailureToast(text: string, retry?: () => void): void {
  const now = Date.now();
  if (now - (lastShown.get(text) ?? 0) < SAME_MESSAGE_MS) return;
  if (lastShown.size > 200) lastShown.clear(); // 文言に ID や件数が入ると種類が増えるので、溜め込まない
  lastShown.set(text, now);
  // やり直しでまた失敗したときに、5 秒の抑制で通知が出ないことがないよう、やり直す前に抑制を解く
  showToast(text.length > 120 ? `${text.slice(0, 120)}…` : text, "error", retry ? { retry: () => { lastShown.delete(text); retry(); } } : {});
}

let installed = false;

/** main.tsx から一度だけ呼ぶ */
export function installFailureToasts(): void {
  if (installed || typeof console === "undefined") return;
  installed = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    original(...args);
    const text = failureToastText(args);
    if (text) showFailureToast(text);
  };
}

/**
 * 操作の失敗を、利用者に知らせる (明示の経路)。`.catch(reportFailure)` のように使う。
 * 開発者向けのログには `console.error(...)` (説明つき) を使い、利用者にも知らせたい失敗はこちらを使う。
 * console.error の差し替え (installFailureToasts) に頼らない。
 * `retry` を渡すと、通知と通知の履歴に「再試行」が出る (保存のように、同じ操作をもう一度できるものだけに付ける)。
 */
export function reportFailure(e: unknown, what?: string, retry?: () => void): void {
  const err = e instanceof Error ? e : new Error(String(e));
  console.error(`[failure]${what ? ` ${what}` : ""}`, err);
  const text = failureToastText([err]);
  if (!text) return; // 中断など、通知にしない失敗
  // 接続できない失敗は、どの操作でも同じ案内 (サーバの状態) を出す。ほかは、操作の名前つき
  const detail = failureDetail(err);
  // 保存が止まったときは、最初の要確認の欄へ移る (原因の欄を探さなくてよいように。UI 改善提案 第 5 弾 #92)
  if (what && /保存/.test(what) && !isConnectionError(err)) setTimeout(() => { const m = document.getElementById("app-main"); if (m) focusFirstIssue(m); }, 100);
  showFailureToast(what && !isConnectionError(err) ? (detail ? `${what}に失敗しました: ${detail}` : `${what}に失敗しました`) : text, retry);
}

/**
 * 操作 (保存など) を実行し、失敗したら通知する。通知と通知の履歴に「再試行」が付き、押すと同じ操作をもう一度実行する。
 * `() => handleSave()` のように、何度呼んでも同じ意味になる操作だけに使う。再試行は、渡した関数をそのまま呼び直すので、
 * 保存のように、呼ぶ時点の最新の内容を (ref などで) 読む関数に限る (描画時の値を握ったままの関数だと、古い内容を保存してしまう)。
 */
export function runReporting(fn: () => Promise<unknown>, what: string): void {
  const run = () => { fn().catch((e) => reportFailure(e, what, run)); };
  run();
}
