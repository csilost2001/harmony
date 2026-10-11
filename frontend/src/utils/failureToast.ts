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

/** 通知にする失敗の文言。通知にしない失敗 (中断など) は null */
export function failureToastText(args: readonly unknown[]): string | null {
  if (args.length !== 1) return null;
  const e = args[0];
  if (!(e instanceof Error)) return null;
  if (e.name === "AbortError") return null;
  if (isConnectionError(e)) return "サーバに接続できないため、操作できませんでした";
  const msg = (e.message || "").trim();
  // サーバ側の ID 検査の英語のメッセージは、日本語にする
  if (/^Invalid \w+: must be kebab-case/.test(msg)) return "操作に失敗しました: ID の形式が正しくありません (英小文字で始まり、英小文字・数字・ハイフンだけ。64 字まで)";
  return msg ? `操作に失敗しました: ${msg}` : "操作に失敗しました";
}

let installed = false;

/** main.tsx から一度だけ呼ぶ */
export function installFailureToasts(): void {
  if (installed || typeof console === "undefined") return;
  installed = true;
  const original = console.error.bind(console);
  const last = new Map<string, number>();
  console.error = (...args: unknown[]) => {
    original(...args);
    const text = failureToastText(args);
    if (!text) return;
    const now = Date.now();
    if (now - (last.get(text) ?? 0) < SAME_MESSAGE_MS) return;
    last.set(text, now);
    showToast(text.length > 120 ? `${text.slice(0, 120)}…` : text, "error");
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
  if (text) showToast(what ? `${what}に失敗しました: ${err.message}` : text, "error");
}
