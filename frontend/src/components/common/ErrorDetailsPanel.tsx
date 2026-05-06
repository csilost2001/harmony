/**
 * エラーメッセージ・スタック・エラーログ履歴を表示し、クリップボードコピー／JSON DL を提供する。
 * AppErrorFallback / TabErrorFallback / ErrorDialog から共通利用。
 *
 * 目的: ユーザーが「どう伝えれば治るか」困ったときに、最小限の操作でログを共有できるようにする。
 */
import { useCallback, useMemo, useState } from "react";
import { clearErrorLog, getErrorLog, type ErrorLogEntry } from "../../utils/errorLog";

interface Props {
  /** 見出しの次に出るエラーメッセージ。error.message などを想定。 */
  message: string;
  /** エラースタック（error.stack）。あれば展開可能セクションに表示。 */
  stack?: string;
  /** 追加のコンテキスト情報。screenId, tabId などを想定。 */
  context?: Record<string, unknown>;
  /** 履歴ログ表示を省く場合 true。通常は false。 */
  hideHistory?: boolean;
}

/** クリップボードにテキストを書き出す。Clipboard API が使えない場合は textarea フォールバック。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallthrough to legacy */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function buildReport(
  message: string,
  stack: string | undefined,
  context: Record<string, unknown> | undefined,
  history: ErrorLogEntry[],
): string {
  return JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      url: typeof location !== "undefined" ? location.href : undefined,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      message,
      stack,
      context,
      history,
    },
    null,
    2,
  );
}

export function ErrorDetailsPanel({ message, stack, context, hideHistory }: Props) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [stackOpen, setStackOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const history = useMemo(() => (hideHistory ? [] : getErrorLog()), [hideHistory]);

  const report = useMemo(
    () => buildReport(message, stack, context, history),
    [message, stack, context, history],
  );

  const handleCopy = useCallback(async () => {
    const ok = await copyText(report);
    setCopyState(ok ? "copied" : "failed");
    setTimeout(() => setCopyState("idle"), 2000);
  }, [report]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([report], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `designer-error-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report]);

  const handleClearHistory = useCallback(() => {
    if (!confirm("エラーログ履歴を消去します。よろしいですか？")) return;
    clearErrorLog();
    setHistoryOpen(false);
  }, []);

  return (
    <div className="error-details">
      <pre className="error-details-message">{message}</pre>

      {stack && (
        <details
          className="error-details-block"
          open={stackOpen}
          onToggle={(e) => setStackOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>スタックトレース</summary>
          <pre className="error-details-pre">{stack}</pre>
        </details>
      )}

      {context && Object.keys(context).length > 0 && (
        <details className="error-details-block">
          <summary>コンテキスト</summary>
          <pre className="error-details-pre">{JSON.stringify(context, null, 2)}</pre>
        </details>
      )}

      {!hideHistory && (
        <details
          className="error-details-block"
          open={historyOpen}
          onToggle={(e) => setHistoryOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>
            エラーログ履歴（直近 {history.length} 件）
          </summary>
          {history.length === 0 ? (
            <p className="error-details-empty">履歴はありません。</p>
          ) : (
            <pre className="error-details-pre">{JSON.stringify(history, null, 2)}</pre>
          )}
        </details>
      )}

      <div className="error-details-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleCopy}
          title="レポート JSON をクリップボードにコピー"
          data-testid="error-copy-btn"
          data-copy-state={copyState}
        >
          <i className="bi bi-clipboard" />{" "}
          {copyState === "copied" ? "コピー済み" : copyState === "failed" ? "コピー失敗" : "レポートをコピー"}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleDownload}
          title="レポート JSON をファイル保存"
        >
          <i className="bi bi-download" /> レポートをダウンロード
        </button>
        {!hideHistory && history.length > 0 && (
          <button
            type="button"
            className="btn btn-link btn-sm"
            onClick={handleClearHistory}
            title="localStorage の履歴ログを消去"
          >
            履歴を消去
          </button>
        )}
      </div>
    </div>
  );
}
