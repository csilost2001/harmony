/**
 * `.catch(console.error)` で握りつぶされた操作の失敗を、画面にも知らせる。
 * 一覧の保存・削除・複製などは、失敗してもコンソールに出るだけで、利用者には何も起きなかったように見えていた。
 * エラー 1 つだけを渡された console.error (= `.catch(console.error)` の形) を、通知として出す。
 * 説明文つきの console.error (引数が複数) は、開発者向けのログなので、通知にしない。
 */
import { isConnectionError } from "./connectionError";
import { showToast } from "./toast";

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
function showFailureToast(text: string): void {
  const now = Date.now();
  if (now - (lastShown.get(text) ?? 0) < SAME_MESSAGE_MS) return;
  if (lastShown.size > 200) lastShown.clear(); // 文言に ID や件数が入ると種類が増えるので、溜め込まない
  lastShown.set(text, now);
  showToast(text.length > 120 ? `${text.slice(0, 120)}…` : text, "error");
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
 */
export function reportFailure(e: unknown, what?: string): void {
  const err = e instanceof Error ? e : new Error(String(e));
  console.error(`[failure]${what ? ` ${what}` : ""}`, err);
  const text = failureToastText([err]);
  if (!text) return; // 中断など、通知にしない失敗
  // 接続できない失敗は、どの操作でも同じ案内 (サーバの状態) を出す。ほかは、操作の名前つき
  const detail = failureDetail(err);
  showFailureToast(what && !isConnectionError(err) ? (detail ? `${what}に失敗しました: ${detail}` : `${what}に失敗しました`) : text);
}
